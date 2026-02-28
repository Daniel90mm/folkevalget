#!/usr/bin/env python3
"""Download official Folketinget portraits via a local Chrome session."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from fetch_data import extract_tag, normalize_photo_url


ODA_ACTOR_URL = "https://oda.ft.dk/api/Akt%C3%B8r({actor_id})?$format=json"
DEFAULT_SEED_URL = "https://www.ft.dk/medlemmer/mf/a/alex-vanopslagh"
DEFAULT_CHROME_PATHS = (
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
)
PHOTO_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profiles", default="data/profiler.json", help="Path to existing profiles.json")
    parser.add_argument("--photos-dir", default="photos", help="Directory for cached portrait files")
    parser.add_argument("--limit", type=int, default=0, help="Only process the first N profiles")
    parser.add_argument(
        "--ids",
        default="",
        help="Comma-separated actor ids to process instead of the whole dataset.",
    )
    parser.add_argument("--chrome-path", default="", help="Path to chrome.exe")
    parser.add_argument("--debug-port", type=int, default=9230, help="Remote debugging port for Chrome")
    return parser.parse_args()


def load_profiles(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def discover_chrome_path(raw_path: str) -> str:
    if raw_path:
        path = Path(raw_path)
        if path.exists():
            return str(path)
        raise FileNotFoundError(f"Chrome not found at {raw_path}")
    for candidate in DEFAULT_CHROME_PATHS:
        if candidate.exists():
            return str(candidate)
    raise FileNotFoundError("Could not find chrome.exe")


def fetch_actor(actor_id: int) -> dict:
    req = Request(
        ODA_ACTOR_URL.format(actor_id=actor_id),
        headers={"User-Agent": "folkevalget-ft-photo-importer/1.0", "Accept": "application/json"},
    )
    with urlopen(req, timeout=30) as response:
        return json.load(response)


def normalize_slug(text: str) -> str:
    text = text.lower().strip()
    text = (
        text.replace("æ", "ae")
        .replace("ø", "oe")
        .replace("å", "aa")
        .replace("ð", "oe")
        .replace("þ", "th")
    )
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return re.sub(r"-{2,}", "-", text).strip("-")


def slug_from_photo_url(photo_url: str | None) -> str | None:
    if not photo_url:
        return None
    parts = [part for part in urlparse(photo_url).path.split("/") if part]
    if len(parts) < 2:
        return None
    return parts[-2] or None


def official_photo_url(actor: dict) -> str | None:
    biography = actor.get("biografi")
    return normalize_photo_url(extract_tag(biography, "pictureMiRes"))


def candidate_member_urls(profile: dict, actor: dict) -> list[str]:
    urls: list[str] = []
    member_url = profile.get("member_url")
    if member_url:
        urls.append(member_url)

    photo_slug = slug_from_photo_url(official_photo_url(actor))
    if photo_slug:
        urls.append(f"https://www.ft.dk/medlemmer/mf/{photo_slug[0]}/{photo_slug}")

    name_slug = normalize_slug(profile["name"])
    if name_slug:
        urls.append(f"https://www.ft.dk/medlemmer/mf/{name_slug[0]}/{name_slug}")

    deduped: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if url not in seen:
            deduped.append(url)
            seen.add(url)
    return deduped


def wait_for_cdp(chrome_path: str, debug_port: int, seed_url: str, user_data_dir: Path) -> subprocess.Popen:
    process = subprocess.Popen(
        [
            chrome_path,
            f"--remote-debugging-port={debug_port}",
            f"--user-data-dir={user_data_dir}",
            "--no-first-run",
            "--no-default-browser-check",
            seed_url,
        ]
    )
    return process


def write_image_file(target_dir: Path, actor_id: int, body: bytes, content_type: str | None) -> str:
    extension = PHOTO_EXTENSIONS.get((content_type or "").split(";")[0].strip().lower(), ".jpg")
    target_path = target_dir / f"{actor_id}{extension}"
    target_path.write_bytes(body)
    return target_path.name


def fetch_portrait(page, member_url: str) -> tuple[str, bytes, str | None] | None:
    captured: dict[str, tuple[bytes, str | None]] = {}

    def handle_response(response) -> None:
        if response.request.resource_type != "image":
            return
        if "/-/media/cv/foto/" not in response.url:
            return
        try:
            captured[response.url] = (response.body(), response.headers.get("content-type"))
        except Exception:
            return

    page.on("response", handle_response)
    try:
        page.goto(member_url, wait_until="networkidle", timeout=60000)
        img = page.locator("img.bio-image").first
        img.wait_for(state="visible", timeout=15000)
        src = img.get_attribute("src")
        if not src:
            return None
        payload = captured.get(src)
        if payload is None:
            with page.expect_response(lambda response: response.url == src and response.request.resource_type == "image", timeout=20000) as response_info:
                page.reload(wait_until="networkidle", timeout=60000)
            response = response_info.value
            payload = (response.body(), response.headers.get("content-type"))
        return src, payload[0], payload[1]
    except PlaywrightTimeoutError:
        return None
    finally:
        try:
            page.remove_listener("response", handle_response)
        except Exception:
            pass


def main() -> None:
    args = parse_args()
    profiles_path = Path(args.profiles)
    photos_dir = Path(args.photos_dir)
    temp_dir = photos_dir.parent / f"{photos_dir.name}_ft_import"

    chrome_path = discover_chrome_path(args.chrome_path)
    profiles = load_profiles(profiles_path)
    if args.ids.strip():
        requested_ids = {int(item.strip()) for item in args.ids.split(",") if item.strip()}
        profiles = [profile for profile in profiles if profile["id"] in requested_ids]
    if args.limit > 0:
        profiles = profiles[: args.limit]

    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True, exist_ok=True)
    if args.ids.strip() and photos_dir.exists():
        shutil.copytree(photos_dir, temp_dir, dirs_exist_ok=True)

    user_data_dir = Path("tmp_chrome_ft_profile").resolve()
    if user_data_dir.exists():
        shutil.rmtree(user_data_dir)
    user_data_dir.mkdir(parents=True, exist_ok=True)

    process = wait_for_cdp(chrome_path, args.debug_port, DEFAULT_SEED_URL, user_data_dir)
    imported = 0
    failed: list[str] = []

    try:
        time.sleep(8)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{args.debug_port}")
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()
            page.wait_for_load_state("networkidle", timeout=60000)

            for index, profile in enumerate(profiles, start=1):
                actor = fetch_actor(profile["id"])
                urls = candidate_member_urls(profile, actor)
                saved = False
                last_error = ""

                for member_url in urls:
                    result = fetch_portrait(page, member_url)
                    if result is None:
                        last_error = f"no portrait on {member_url}"
                        continue

                    _src, body, content_type = result
                    write_image_file(temp_dir, profile["id"], body, content_type)
                    imported += 1
                    saved = True
                    break

                if not saved:
                    failed.append(f"{profile['name']} ({last_error or 'no usable member URL'})")

                print(f"[{index}/{len(profiles)}] {profile['name']}: {'ok' if saved else 'failed'}", file=sys.stderr)

            browser.close()

        if photos_dir.exists():
            shutil.rmtree(photos_dir)
        temp_dir.replace(photos_dir)
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except Exception:
            process.kill()
        if user_data_dir.exists():
            shutil.rmtree(user_data_dir, ignore_errors=True)
        if temp_dir.exists():
            shutil.rmtree(temp_dir, ignore_errors=True)

    print(
        json.dumps(
            {
                "ok": True,
                "profiles": len(profiles),
                "imported": imported,
                "failed": len(failed),
                "photos_dir": str(photos_dir),
            },
            ensure_ascii=False,
        )
    )
    if failed:
        print("Failed profiles:", file=sys.stderr)
        for item in failed[:30]:
            print(f"- {item}", file=sys.stderr)


if __name__ == "__main__":
    main()
