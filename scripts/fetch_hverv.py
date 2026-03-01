#!/usr/bin/env python3
"""Scraper: hentér hverv og økonomiske interesser fra ft.dk og krydstjek mod CVR.

Bruger samme CDP-tilgang som import_ft_photos.py:
  1. Starter en rigtig Chrome-browser via subprocess (ikke Playwrights bundlede Chromium)
  2. Playwright forbinder til den via Chrome DevTools Protocol (CDP)
  3. Navigerer igennem alle MF-profilsider og ekstraher #hverv-sektionen

Dette omgår Cloudflares bot-detektion fordi den rigtige Chrome-binær har
en autentisk browser-fingerprint.

VIGTIGT: Hvervregisteret er frivilligt. Manglende registreringer betyder
IKKE nødvendigvis at et MF ikke har interesser — kun at de ikke er
registreret. Noteres eksplicit i output.

Brug:
    python3 scripts/fetch_hverv.py                         # fuld kørsel
    python3 scripts/fetch_hverv.py --dry-run               # test mod 5 MF'ere
    python3 scripts/fetch_hverv.py --delay 2.0             # roligere tempo
    python3 scripts/fetch_hverv.py --no-cvr                # spring CVR over
    python3 scripts/fetch_hverv.py --chrome-path "C:/..."  # angiv Chrome-sti
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
PROFILER_FILE = DATA_DIR / "profiler.json"
OUTPUT_FILE = DATA_DIR / "hverv.json"

DEFAULT_DELAY = 1.5
CVR_DELAY = 0.3
REQUEST_TIMEOUT = 30
DEBUG_PORT = 9231

DEFAULT_CHROME_PATHS = (
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files\Chromium\Application\chrome.exe"),
)

CVR_SEARCH_URL = "https://cvrapi.dk/api"
CVR_HEADERS = {
    "User-Agent": "folkevalget-data-fetcher/1.0 (https://folkevalget.dk)",
    "Accept": "application/json",
}


# ---------------------------------------------------------------------------
# Chrome-start via CDP (samme metode som import_ft_photos.py)
# ---------------------------------------------------------------------------

def find_chrome(explicit_path: str = "") -> str:
    if explicit_path:
        p = Path(explicit_path)
        if p.exists():
            return str(p)
        raise FileNotFoundError(f"Chrome ikke fundet: {explicit_path}")
    for candidate in DEFAULT_CHROME_PATHS:
        if candidate.exists():
            return str(candidate)
    raise FileNotFoundError(
        "Kan ikke finde Chrome. Angiv stien med --chrome-path."
    )


def start_chrome(chrome_path: str, user_data_dir: Path, seed_url: str) -> subprocess.Popen:
    return subprocess.Popen([
        chrome_path,
        f"--remote-debugging-port={DEBUG_PORT}",
        f"--user-data-dir={user_data_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        seed_url,
    ])


# ---------------------------------------------------------------------------
# ft.dk hverv-scraping
# ---------------------------------------------------------------------------

def mf_url(profil: dict) -> str:
    url = profil.get("member_url", "")
    if url and "/da/" not in url:
        url = url.replace("https://www.ft.dk/", "https://www.ft.dk/da/")
    return url


def hent_hverv_html(page, url: str, timeout_sek: int = 60, retries: int = 3) -> str | None:
    """Naviger til MF-side og returner inner_html af #hverv-div, eller None.

    Prøver op til `retries` gange — Cloudflare kan rejse en ny challenge
    midt i en kørsel, og en enkelt genindlæsning løser det typisk.
    """
    for forsøg in range(1, retries + 1):
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_sek * 1000)
        except PlaywrightTimeoutError:
            pass  # Siden er muligvis klar alligevel
        except Exception as exc:
            print(f"  Navigeringsfejl (forsøg {forsøg}): {exc}", file=sys.stderr)
            if forsøg < retries:
                time.sleep(3)
                continue
            return None

        # Vent på at #hverv dukker op (indikator for at siden er loadet korrekt)
        try:
            el = page.wait_for_selector("#hverv", timeout=20000)
            if el:
                return el.inner_html()
        except Exception:
            pass

        # Hvis vi stadig er på Cloudflare-siden, vent og prøv igen
        title = ""
        try:
            title = page.title()
        except Exception:
            pass
        if "jeblik" in title or "moment" in title.lower():
            print(f"  CF-challenge aktiv (forsøg {forsøg}/{retries}), venter 10 sek...", file=sys.stderr)
            time.sleep(10)
        elif forsøg < retries:
            time.sleep(3)

    return None


def parsér_hverv_html(html_tekst: str) -> list[dict]:
    """Parsér rå inner_html fra #hverv-div og returner strukturerede poster."""
    soup = BeautifulSoup(html_tekst, "html.parser")
    poster = []
    for article in soup.find_all("article"):
        if article.find("h3"):           # header-artikel
            continue
        strong_tag = article.find("strong")
        if not strong_tag:               # footer-artikel (kun link)
            continue

        kategori = strong_tag.get_text(strip=True).rstrip(":")
        p_texts = [p.get_text(" ", strip=True) for p in article.find_all("p")]
        beskrivelse = " ".join(t for t in p_texts if t)

        if kategori or beskrivelse:
            poster.append({"kategori": kategori, "beskrivelse": beskrivelse})

    return poster


# ---------------------------------------------------------------------------
# CVR-berigelse via cvrapi.dk
# ---------------------------------------------------------------------------

def cvr_opslag(session: requests.Session, virksomhedsnavn: str) -> dict | None:
    """Slå virksomhed op i CVR. Returnerer dict eller None."""
    try:
        r = session.get(
            CVR_SEARCH_URL,
            params={"search": virksomhedsnavn, "country": "dk"},
            headers=CVR_HEADERS,
            timeout=REQUEST_TIMEOUT,
        )
        if r.status_code == 404:
            return None
        r.raise_for_status()
        d = r.json()
        return {
            "cvr_nummer": str(d.get("vat", "")),
            "virksomhedsnavn": d.get("name", ""),
            "type": d.get("companytype", ""),
            "branche": d.get("industrydesc", ""),
            "adresse": ", ".join(
                p for p in [d.get("address", ""), d.get("zipcode", ""), d.get("city", "")] if p
            ),
            "aktiv": d.get("enddate") is None,
        }
    except Exception as exc:
        print(f"  CVR-fejl for {virksomhedsnavn!r}: {exc}", file=sys.stderr)
        return None


def berig_med_cvr(session: requests.Session, poster: list[dict]) -> list[dict]:
    """Tilføj CVR-data til poster hvor virksomhedsnavn kan uddrages."""
    berigede = []
    for post in poster:
        cvr = None
        match = re.search(r'[""«»„]([^""«»„]+)[""«»„]', post.get("beskrivelse", ""))
        if match:
            cvr = cvr_opslag(session, match.group(1).strip())
            if cvr:
                print(f"    CVR: {cvr['virksomhedsnavn']} ({cvr['cvr_nummer']})")
            time.sleep(CVR_DELAY)
        berigede.append({**post, "cvr": cvr})
    return berigede


# ---------------------------------------------------------------------------
# Hoved
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Hent hverv og CVR for Folketing-medlemmer")
    p.add_argument("--dry-run", action="store_true", help="Test mod de første 5 MF'ere")
    p.add_argument("--delay", type=float, default=DEFAULT_DELAY, help="Sekunder mellem ft.dk-kald")
    p.add_argument("--no-cvr", action="store_true", help="Spring CVR-opslag over")
    p.add_argument("--chrome-path", default="", help="Sti til chrome.exe")
    p.add_argument(
        "--retry-fejl", action="store_true",
        help="Kør kun mod MF'ere der fejlede (CF-blokeret) i forrige kørsel",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()

    with open(PROFILER_FILE, encoding="utf-8") as f:
        profiler: list[dict] = json.load(f)

    # Indlæs eksisterende output (bruges til --retry-fejl og crash-recovery)
    existing: dict = {}
    if OUTPUT_FILE.exists():
        try:
            with open(OUTPUT_FILE, encoding="utf-8") as f:
                existing = json.load(f).get("medlemmer", {})
        except Exception:
            pass

    if args.retry_fejl:
        # Filtrér til kun MF'ere der er CF-blokerede i eksisterende output
        cf_ids = {
            k for k, v in existing.items()
            if v.get("fejl") and "CF" in (v.get("fejl") or "")
        }
        # Tilføj MF'ere der mangler helt (script stoppet midt i)
        eksisterende_ids = set(existing.keys())
        alle_ids = {str(p["id"]) for p in profiler}
        manglende_ids = alle_ids - eksisterende_ids
        kør_ids = cf_ids | manglende_ids
        profiler = [p for p in profiler if str(p["id"]) in kør_ids]
        print(f"RETRY: {len(profiler)} MF'ere (CF-blokerede + manglende)")
    elif args.dry_run:
        profiler = profiler[:5]
        print(f"DRY-RUN: {len(profiler)} MF'ere")

    total = len(profiler)
    chrome_path = find_chrome(args.chrome_path)
    print(f"Chrome fundet: {chrome_path}")

    user_data_dir = (ROOT / "tmp_chrome_hverv_profile").resolve()
    if user_data_dir.exists():
        shutil.rmtree(user_data_dir)
    user_data_dir.mkdir(parents=True, exist_ok=True)

    seed_url = "https://www.ft.dk/da/medlemmer/mf/i/ida-auken"
    process = start_chrome(chrome_path, user_data_dir, seed_url)

    cvr_session = requests.Session()
    output: dict[str, Any] = {
        "genereret": str(date.today()),
        "antal_mf": len(json.load(open(PROFILER_FILE, encoding="utf-8"))),
        "note": (
            "Hvervregisteret er frivilligt. Manglende registreringer betyder "
            "IKKE nødvendigvis fraværet af økonomiske interesser."
        ),
        # Start fra eksisterende data (crash-recovery og --retry-fejl)
        "medlemmer": existing.copy(),
    }

    print("Venter på Chrome starter... (8 sek)")
    time.sleep(8)

    try:
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{DEBUG_PORT}")
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()
            page.wait_for_load_state("networkidle", timeout=60000)
            print("Forbundet til Chrome via CDP. Starter indsamling...\n")

            for i, profil in enumerate(profiler, 1):
                mf_id = str(profil["id"])
                navn = profil["name"]
                url = mf_url(profil)

                print(f"[{i}/{total}] {navn}")

                hverv_html = hent_hverv_html(page, url)
                if hverv_html is None:
                    # Skeln: CF-blocked (siden loadede aldrig) vs. siden
                    # loadede men har ingen #hverv-sektion (legitimt for
                    # nye MF'ere, afdøde MF'ere, Færø/Grønland-mandater).
                    title = ""
                    try:
                        title = page.title()
                    except Exception:
                        pass
                    cf_blokeret = "jeblik" in title or "moment" in title.lower()

                    if cf_blokeret:
                        print(f"  CF-blokeret: {url}", file=sys.stderr)
                        status_fejl = "CF-blokeret — prøv igen"
                    else:
                        print(f"  Ingen hverv-sektion på siden (legitimt): {navn}")
                        status_fejl = None  # Ikke en fejl — siden har bare ingen sektion

                    output["medlemmer"][mf_id] = {
                        "id": profil["id"],
                        "navn": navn,
                        "registreringer": [],
                        "ingen_registreringer": True if not cf_blokeret else None,
                        "ingen_hverv_sektion": not cf_blokeret,
                        "registrering_note": (
                            None if cf_blokeret else
                            "Siden har ingen hverv-sektion. "
                            "Registreringen er frivillig."
                        ),
                        "kilde_url": url,
                        "hentet": str(date.today()),
                        "fejl": status_fejl,
                    }
                    # Gem løbende
                    OUTPUT_FILE.write_text(
                        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
                    )
                    continue

                poster = parsér_hverv_html(hverv_html)
                ingen_reg = len(poster) == 0

                if poster:
                    print(f"  {len(poster)} registrering(er)")
                else:
                    print("  Ingen registreringer (frivilligt register)")

                if not args.no_cvr and poster:
                    poster = berig_med_cvr(cvr_session, poster)

                output["medlemmer"][mf_id] = {
                    "id": profil["id"],
                    "navn": navn,
                    "registreringer": poster,
                    "ingen_registreringer": ingen_reg,
                    "registrering_note": (
                        None if poster else
                        "Ingen registreringer. Registreringen er frivillig — "
                        "dette er ikke ensbetydende med fraværet af interesser."
                    ),
                    "kilde_url": url,
                    "hentet": str(date.today()),
                }

                # Gem løbende (crash-safe)
                OUTPUT_FILE.write_text(
                    json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
                )

                if i < total:
                    time.sleep(args.delay)

            browser.close()

    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except Exception:
            process.kill()
        if user_data_dir.exists():
            shutil.rmtree(user_data_dir, ignore_errors=True)

    med_reg = sum(1 for m in output["medlemmer"].values() if m.get("registreringer"))
    print(f"\nFærdig. Skrev {OUTPUT_FILE}")
    print(f"{med_reg}/{total} MF'ere har registreringer.")
    print(
        f"OBS: {total - med_reg} uden registreringer != ingen interesser "
        f"(registreringen er frivillig)."
    )


if __name__ == "__main__":
    main()
