#!/usr/bin/env python3
"""Scrape Redegørelser (R) and Forespørgsler (F) document lists from ft.dk.

Uses a local Chrome session via CDP (same pattern as import_ft_photos.py).
Iterates through all parliamentary sessions (samlinger) from 2022 onwards.

Output: data/ft_dokumenter_rf.json

Usage:
  python scripts/fetch_ft_rf_documents.py --verbose
  python scripts/fetch_ft_rf_documents.py --type R --verbose
  python scripts/fetch_ft_rf_documents.py --type F --verbose
  python scripts/fetch_ft_rf_documents.py --dump-html --verbose
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
OUTPUT_FILE = DATA_DIR / "ft_dokumenter_rf.json"

# ft.dk document list base URLs
FT_DOCUMENT_URLS: dict[str, str] = {
    "R": "https://www.ft.dk/da/dokumenter/dokumentlister/redegoerelser",
    "F": "https://www.ft.dk/da/dokumenter/dokumentlister/forespoergsler",
}

SEED_URL = "https://www.ft.dk/da"
DEBUG_PORT = 9240
WAIT_AFTER_LAUNCH = 8

# Only fetch sessions from this year onwards (matches our vote data start date)
MIN_SESSION_CODE = 20221  # 2022-23 (1. samling)

DEFAULT_CHROME_PATHS = (
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files\Chromium\Application\chrome.exe"),
)

# ft.dk selector for document list rows
ROW_SELECTOR = "tr.listespot-wrapper__data-item"

# JS to extract structured rows from the ft.dk document table
EXTRACT_ROWS_JS = """() => {
    const rows = document.querySelectorAll('tr.listespot-wrapper__data-item');
    const results = [];
    for (const row of rows) {
        const dataUrl = row.getAttribute('data-url');
        const getCell = (title) => {
            const td = row.querySelector(`td[data-title="${title}"]`);
            if (!td) return null;
            const p = td.querySelector('p.column-documents__icon-text');
            return p ? p.innerText.trim() || null : null;
        };
        const nummer   = getCell('Nr.');
        const titel    = getCell('Titel');
        if (!nummer || !titel) continue;
        results.push({
            href:         dataUrl,
            nummer:       nummer,
            titel:        titel,
            afgivet_af:   getCell('Afgivet af') || getCell('Minister') || null,
            forespoergere: getCell('Forespørgere') || null,
            status:       getCell('Status') || null,
            samling:      getCell('Samling') || null,
        });
    }
    return results;
}"""

# JS to enumerate available samling (session) options in the period dropdown
LIST_SESSIONS_JS = f"""() => {{
    const sel = document.querySelector('select.drpPeriodSelect, select[name="periodFilter"]');
    if (!sel) return [];
    return Array.from(sel.options)
        .filter(o => /^\\d{{5}}$/.test(o.value) && parseInt(o.value, 10) >= {MIN_SESSION_CODE})
        .map(o => ({{ value: o.value, text: o.text.trim() }}));
}}"""


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", default=str(OUTPUT_FILE), help="Output JSON path")
    parser.add_argument("--chrome-path", default="", help="Path to chrome.exe")
    parser.add_argument("--debug-port", type=int, default=DEBUG_PORT)
    parser.add_argument("--type", choices=["R", "F", "both"], default="both", help="Which document type to scrape")
    parser.add_argument("--dump-html", action="store_true", help="Dump raw page HTML for debugging")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def log(verbose: bool, msg: str) -> None:
    if verbose:
        print(f"[ft-rf] {msg}", file=sys.stderr)


def discover_chrome_path(raw_path: str) -> str:
    if raw_path:
        path = Path(raw_path)
        if path.exists():
            return str(path)
        raise FileNotFoundError(f"Chrome not found at {raw_path}")
    for candidate in DEFAULT_CHROME_PATHS:
        if candidate.exists():
            return str(candidate)
    raise FileNotFoundError("Could not find chrome.exe in default locations")


def clean_text(text: str | None) -> str | None:
    if not text:
        return None
    cleaned = " ".join(text.split())
    return cleaned or None


# ---------------------------------------------------------------------------
# Scraping helpers
# ---------------------------------------------------------------------------

def extract_rows(page, verbose: bool) -> list[dict[str, Any]]:
    """Extract document rows from the current ft.dk document list page."""
    try:
        raw_rows = page.evaluate(EXTRACT_ROWS_JS)
    except Exception as exc:
        log(verbose, f"  JS eval error: {exc}")
        return []

    docs: list[dict[str, Any]] = []
    for row in raw_rows or []:
        nummer = clean_text(row.get("nummer"))
        titel = clean_text(row.get("titel"))
        if not nummer or not titel:
            continue
        docs.append({
            "nummer":       nummer,
            "titel":        titel,
            "afgivet_af":   clean_text(row.get("afgivet_af")),
            "forespoergere": clean_text(row.get("forespoergere")),
            "status":       clean_text(row.get("status")),
            "samling":      clean_text(row.get("samling")),
            "href":         row.get("href"),
        })
    return docs


def list_sessions(page, verbose: bool) -> list[dict[str, str]]:
    """Return all samling options on the current page with code >= MIN_SESSION_CODE."""
    try:
        sessions = page.evaluate(LIST_SESSIONS_JS)
        log(verbose, f"  sessions available: {[s['text'] for s in sessions]}")
        return sessions or []
    except Exception as exc:
        log(verbose, f"  session list error: {exc}")
        return []


def select_session(page, session_value: str, verbose: bool) -> bool:
    """Select a samling in the filter dropdown and wait for results to reload."""
    selector = 'select.drpPeriodSelect, select[name="periodFilter"]'
    try:
        page.select_option(selector, value=session_value)
        page.wait_for_load_state("networkidle", timeout=30000)
        return True
    except PlaywrightTimeoutError:
        log(verbose, f"  timeout selecting session {session_value}")
        return False
    except Exception as exc:
        log(verbose, f"  error selecting session {session_value}: {exc}")
        return False


def scrape_document_type(
    page,
    doc_type: str,
    base_url: str,
    *,
    dump_html: bool = False,
    verbose: bool = False,
) -> list[dict[str, Any]]:
    """Scrape all sessions for one document type (R or F)."""
    log(verbose, f"navigating to {base_url}")
    page.goto(base_url, wait_until="networkidle", timeout=90000)

    if dump_html:
        html_path = DATA_DIR / f"ft_{doc_type.lower()}_page.html"
        html_path.write_text(page.content(), encoding="utf-8")
        log(True, f"HTML dumped to {html_path}")

    log(verbose, f"page title: {page.title()}")

    all_docs: list[dict[str, Any]] = []
    seen_nummers: set[str] = set()

    def add_rows(rows: list[dict[str, Any]], session_label: str) -> None:
        for row in rows:
            key = f"{doc_type}|{row['nummer']}"
            if key in seen_nummers:
                continue
            seen_nummers.add(key)
            row["type"] = doc_type
            all_docs.append(row)
            log(verbose, f"  [{session_label}] {row['nummer']} — {row['titel'][:60]}")

    # Scrape the initial (default) session
    initial_rows = extract_rows(page, verbose)
    initial_session = initial_rows[0].get("samling", "default") if initial_rows else "default"
    log(verbose, f"  initial session: {initial_session}, {len(initial_rows)} rows")
    add_rows(initial_rows, initial_session)

    # Enumerate and iterate all sessions
    sessions = list_sessions(page, verbose)
    for session in sessions:
        session_val = session["value"]
        session_text = session["text"]

        log(verbose, f"  selecting session {session_text} ({session_val})")
        if not select_session(page, session_val, verbose):
            continue

        rows = extract_rows(page, verbose)
        log(verbose, f"    {len(rows)} rows")
        add_rows(rows, session_text)

    log(verbose, f"{doc_type}: total {len(all_docs)} unique documents across sessions")
    return all_docs


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    args = parse_args()
    output_path = Path(args.output)
    chrome_path = discover_chrome_path(args.chrome_path)

    types_to_scrape: dict[str, str] = {}
    if args.type == "both":
        types_to_scrape = FT_DOCUMENT_URLS
    else:
        types_to_scrape = {args.type: FT_DOCUMENT_URLS[args.type]}

    user_data_dir = Path("tmp_chrome_rf_profile").resolve()
    if user_data_dir.exists():
        shutil.rmtree(user_data_dir)
    user_data_dir.mkdir(parents=True, exist_ok=True)

    process = subprocess.Popen([
        chrome_path,
        f"--remote-debugging-port={args.debug_port}",
        f"--user-data-dir={user_data_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        SEED_URL,
    ])

    all_documents: list[dict[str, Any]] = []

    try:
        time.sleep(WAIT_AFTER_LAUNCH)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{args.debug_port}")
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()
            page.wait_for_load_state("networkidle", timeout=60000)

            for doc_type, url in types_to_scrape.items():
                docs = scrape_document_type(
                    page, doc_type, url,
                    dump_html=args.dump_html,
                    verbose=args.verbose,
                )
                all_documents.extend(docs)
                print(f"[ft-rf] {doc_type}: {len(docs)} documents scraped", file=sys.stderr)

            browser.close()

    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except Exception:
            process.kill()
        if user_data_dir.exists():
            shutil.rmtree(user_data_dir, ignore_errors=True)

    # Sort: type → samling descending → nummer descending
    def sort_key(doc: dict[str, Any]) -> tuple:
        samling = doc.get("samling") or ""
        nummer = doc.get("nummer") or ""
        num_match = re.search(r"\d+", nummer)
        num = int(num_match.group()) if num_match else 0
        return (doc.get("type", ""), samling, -num)

    all_documents.sort(key=sort_key)

    output_path.write_text(
        json.dumps(all_documents, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    summary = {"ok": True, "total": len(all_documents), "output": str(output_path)}
    for doc_type in types_to_scrape:
        summary[doc_type] = sum(1 for d in all_documents if d.get("type") == doc_type)

    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
