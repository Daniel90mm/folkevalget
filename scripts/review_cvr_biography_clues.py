#!/usr/bin/env python3
"""Review unresolved CVR not_found cases via company clues in official biographies.

This is a local review helper. It does not write tracked data. It reads
unresolved members from data/cvr_personer.json, extracts likely company/board
clues from official ODA biographies, and checks whether those companies expose
matching person names in Virk company history.
"""

from __future__ import annotations

import argparse
import html
import importlib.util
import json
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CVR_FILE = DATA_DIR / "cvr_personer.json"
PROFILES_FILE = DATA_DIR / "profiler.json"
LOCAL_OVERRIDES_FILE = ROOT / "LOCAL_CVR_OVERRIDES.json"

ODA_ACTOR_URL = "https://oda.ft.dk/api/Akt%C3%B8r"

ROLE_PATTERNS = (
    re.compile(
        r"(?:Formand for bestyrelsen for|Medlem af bestyrelsen for|Bestyrelsesmedlem i|"
        r"Medlem af repræsentantskabet for)\s+([^.;]{2,120})",
        re.IGNORECASE,
    ),
)

COMPANY_TAIL_PATTERNS = (
    re.compile(r"([A-ZÆØÅ0-9][A-Za-zÆØÅæøå0-9&./,'()\- ]{1,120}\b(?:A/S|ApS|I/S|K/S|P/S|AMBA|FMBA|SMBA))"),
    re.compile(r"([A-ZÆØÅ0-9][A-Za-zÆØÅæøå0-9&./,'()\- ]{1,120}\b(?:Privathospital|forsikringsaktieselskab|Kulturfond|Kursuscenter))"),
)

PERSON_LINK_PATTERN = re.compile(r"/enhed/person/(\d+)/deltager[^>]*>([^<]+)<")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ids", default="", help="Comma-separated member IDs to inspect.")
    parser.add_argument("--limit", type=int, default=10, help="Max unresolved members to inspect.")
    parser.add_argument(
        "--include-local",
        action="store_true",
        help="Include members already listed in LOCAL_CVR_OVERRIDES.json.",
    )
    return parser.parse_args()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_ids(raw_value: str) -> set[str]:
    values: set[str] = set()
    for part in (raw_value or "").split(","):
        part = part.strip()
        if part:
            values.add(part)
    return values


def normalise_name(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def first_last_tokens(name: str) -> tuple[str, str]:
    tokens = re.findall(r"[A-Za-zÆØÅæøå0-9-]+", name or "")
    if len(tokens) < 2:
        return "", ""
    return tokens[0].lower(), tokens[-1].lower()


def load_unresolved(selected_ids: set[str], limit: int, include_local: bool) -> list[dict[str, Any]]:
    cvr_data = load_json(CVR_FILE)["medlemmer"]
    profiles = {str(profile["id"]): profile for profile in load_json(PROFILES_FILE)}
    local_overrides = load_json(LOCAL_OVERRIDES_FILE)
    if "medlemmer" in local_overrides:
        local_overrides = local_overrides["medlemmer"]

    rows: list[dict[str, Any]] = []
    for member_id, item in cvr_data.items():
        if item.get("status") != "not_found":
            continue
        if not include_local and member_id in local_overrides:
            continue
        if selected_ids and member_id not in selected_ids:
            continue
        rows.append(
            {
                "id": member_id,
                "name": item.get("name") or "",
                "official_name": item.get("official_name") or item.get("name") or "",
                "member_url": profiles.get(member_id, {}).get("member_url"),
            }
        )

    rows.sort(key=lambda row: row["name"])
    return rows[:limit]


def fetch_actor_rows(member_ids: list[str]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for start in range(0, len(member_ids), 40):
        chunk = member_ids[start:start + 40]
        filter_expr = " or ".join(f"id eq {member_id}" for member_id in chunk)
        url = f"{ODA_ACTOR_URL}?{urllib.parse.urlencode({'$filter': filter_expr, '$top': '100', '$format': 'json'})}"
        request = urllib.request.Request(
            url,
            headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.load(response)
        for row in payload.get("value", []):
            result[str(row.get("id"))] = row
    return result


def biography_text(row: dict[str, Any]) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", row.get("biografi") or ""))
    return re.sub(r"\s+", " ", text).strip()


def extract_company_clues(text: str) -> list[str]:
    clues: list[str] = []
    for pattern in ROLE_PATTERNS:
        for match in pattern.findall(text):
            candidate = match.strip(" .,;:")
            tail_match = None
            for tail_pattern in COMPANY_TAIL_PATTERNS:
                tail_match = tail_pattern.search(candidate)
                if tail_match:
                    candidate = tail_match.group(1)
                    break
            if not tail_match:
                titlecase_words = re.findall(r"\b[A-ZÆØÅ][A-Za-zÆØÅæøå\-]+\b", candidate)
                if len(titlecase_words) >= 2:
                    candidate = " ".join(titlecase_words)
            if len(candidate) < 4 or candidate in clues:
                continue
            clues.append(candidate)
    return clues


def load_cvr_fetch_module() -> Any:
    script_path = ROOT / "scripts" / "fetch_cvr_person_data.py"
    spec = importlib.util.spec_from_file_location("cvr_fetch", script_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def matching_person_mentions(raw_json: str, official_name: str) -> list[dict[str, str]]:
    first_token, last_token = first_last_tokens(official_name)
    matches: list[dict[str, str]] = []
    seen: set[str] = set()
    for person_id, person_name in PERSON_LINK_PATTERN.findall(raw_json):
        person_name_clean = re.sub(r"\s+", " ", html.unescape(person_name)).strip()
        lower_name = person_name_clean.lower()
        if first_token and first_token not in lower_name:
            continue
        if last_token and last_token not in lower_name:
            continue
        if person_id in seen:
            continue
        seen.add(person_id)
        matches.append(
            {
                "person_enhedsnummer": person_id,
                "person_name": person_name_clean,
                "person_url": f"https://datacvr.virk.dk/enhed/person/{person_id}/deltager",
            }
        )
    return matches


def inspect_company_clues(members: list[dict[str, Any]], actor_rows: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    cvr_fetch = load_cvr_fetch_module()
    chrome_path = cvr_fetch.find_chrome("")
    user_data_dir = (ROOT / "tmp_chrome_cvr_bio_review").resolve()
    if user_data_dir.exists():
        shutil.rmtree(user_data_dir, ignore_errors=True)
    user_data_dir.mkdir(parents=True, exist_ok=True)

    process = cvr_fetch.start_chrome(chrome_path, user_data_dir, cvr_fetch.CVR_BASE_URL)
    findings: list[dict[str, Any]] = []

    try:
        time.sleep(8)
        with cvr_fetch.sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{cvr_fetch.DEBUG_PORT}")
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()
            try:
                page.wait_for_load_state("networkidle", timeout=60000)
            except Exception:
                pass

            for member in members:
                row = actor_rows.get(member["id"])
                if not row:
                    continue
                bio = biography_text(row)
                company_clues = extract_company_clues(bio)
                if not company_clues:
                    continue

                member_findings = {
                    "id": member["id"],
                    "name": member["name"],
                    "official_name": member["official_name"],
                    "member_url": member.get("member_url"),
                    "company_clues": [],
                }

                for company_clue in company_clues:
                    try:
                        results = cvr_fetch.fetch_search_results(page, company_clue)
                    except Exception:
                        continue

                    exact_matches = cvr_fetch.find_exact_company_matches(results, company_clue)
                    if not exact_matches:
                        continue

                    company_hits: list[dict[str, Any]] = []
                    for match in exact_matches[:3]:
                        cvr_number = str(match.get("cvr") or "")
                        if not cvr_number:
                            continue
                        try:
                            detail = cvr_fetch.fetch_json(
                                page,
                                f"/gateway/virksomhed/hentVirksomhed?cvrnummer={cvr_number}&locale=da",
                                retries=1,
                            )
                        except Exception:
                            continue
                        raw_json = json.dumps(detail, ensure_ascii=False)
                        person_mentions = matching_person_mentions(raw_json, member["official_name"])
                        if not person_mentions:
                            continue
                        company_hits.append(
                            {
                                "company_name": match.get("senesteNavn"),
                                "company_cvr": cvr_number,
                                "company_url": f"https://datacvr.virk.dk/enhed/virksomhed/{match.get('enhedsnummer')}",
                                "person_mentions": person_mentions,
                            }
                        )

                    if company_hits:
                        member_findings["company_clues"].append(
                            {
                                "clue": company_clue,
                                "hits": company_hits,
                            }
                        )

                if member_findings["company_clues"]:
                    findings.append(member_findings)

            browser.close()
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except Exception:
            process.kill()
        shutil.rmtree(user_data_dir, ignore_errors=True)

    return findings


def main() -> None:
    args = parse_args()
    selected_ids = parse_ids(args.ids)
    members = load_unresolved(selected_ids, args.limit, args.include_local)
    actor_rows = fetch_actor_rows([member["id"] for member in members])
    findings = inspect_company_clues(members, actor_rows)
    print(json.dumps(findings, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
