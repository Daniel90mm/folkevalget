#!/usr/bin/env python3
"""Scrape Redegørelser (R) and Forespørgsler (F) document lists from ft.dk.

Uses a local Chrome session via CDP (same pattern as import_ft_photos.py).
Captures network API responses first, falls back to DOM scraping.

Output: data/ft_dokumenter_rf.json

Usage:
  python scripts/fetch_ft_rf_documents.py --verbose
  python scripts/fetch_ft_rf_documents.py --type R --verbose
  python scripts/fetch_ft_rf_documents.py --type F --verbose
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

FT_DOCUMENT_URLS: dict[str, str] = {
    "R": "https://www.ft.dk/da/dokumenter/dokumentlister/redegoerelser",
    "F": "https://www.ft.dk/da/dokumenter/dokumentlister/forespoergsler",
}

SEED_URL = "https://www.ft.dk/da"
DEBUG_PORT = 9240
WAIT_AFTER_LAUNCH = 8

DEFAULT_CHROME_PATHS = (
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files\Chromium\Application\chrome.exe"),
)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", default=str(OUTPUT_FILE), help="Output JSON path")
    parser.add_argument("--chrome-path", default="", help="Path to chrome.exe")
    parser.add_argument("--debug-port", type=int, default=DEBUG_PORT, help="CDP debug port")
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
# DOM scraping helpers
# ---------------------------------------------------------------------------

def try_extract_rows_from_dom(page, doc_type: str, verbose: bool) -> list[dict[str, Any]]:
    """Try multiple selector strategies to extract document rows from DOM."""
    documents: list[dict[str, Any]] = []

    # Strategy 1: look for table rows
    row_selectors = [
        "table tbody tr",
        ".ft-document-list tr",
        "[class*='listing'] tr",
        "[class*='table'] tr",
        "article",
        ".item",
        "[class*='item']",
        "li[class*='doc']",
    ]

    rows = []
    used_selector = ""
    for selector in row_selectors:
        found = page.query_selector_all(selector)
        if found and len(found) > 1:
            rows = found
            used_selector = selector
            log(verbose, f"  DOM strategy: found {len(rows)} rows with '{selector}'")
            break

    if not rows:
        log(verbose, "  DOM strategy: no rows found with any standard selector")
        return documents

    for row in rows:
        try:
            text = clean_text(row.inner_text())
            if not text:
                continue

            # Look for doc number pattern (e.g. "R 1", "F 12")
            nummer_match = re.search(rf"\b{doc_type}\s+\d+\b", text)
            if not nummer_match:
                continue
            nummer = nummer_match.group(0)

            # Extract href
            link = row.query_selector("a")
            href = link.get_attribute("href") if link else None
            link_text = clean_text(link.inner_text()) if link else None

            # Try to find a date pattern
            date_match = re.search(r"\b(\d{1,2}[./]\d{1,2}[./]\d{4}|\d{4}-\d{2}-\d{2})\b", text)
            dato = date_match.group(0) if date_match else None

            # Title: largest chunk of text that isn't the number or date
            title_text = text.replace(nummer, "").replace(dato or "", "").strip()
            title_text = re.sub(r"\s+", " ", title_text).strip(" ·|–-")

            documents.append({
                "type": doc_type,
                "nummer": nummer,
                "title": title_text or link_text,
                "dato": dato,
                "href": href,
            })
            log(verbose, f"  DOM: {nummer} — {(title_text or '')[:60]}")

        except Exception as exc:
            log(verbose, f"  DOM row error: {exc}")

    log(verbose, f"  DOM strategy total: {len(documents)} documents via '{used_selector}'")
    return documents


def evaluate_dom_extraction(page, doc_type: str, verbose: bool) -> list[dict[str, Any]]:
    """Use page.evaluate to run JS in the browser for reliable extraction."""
    try:
        result = page.evaluate(f"""() => {{
            const docType = "{doc_type}";
            const pattern = new RegExp("\\\\b" + docType + "\\\\s+\\\\d+\\\\b");
            const results = [];

            // Try table rows first
            const rows = document.querySelectorAll("table tr, [class*='row'], [class*='item'], article, li");
            for (const row of rows) {{
                const text = row.innerText || "";
                const m = pattern.exec(text);
                if (!m) continue;
                const nummer = m[0];
                const link = row.querySelector("a");
                const href = link ? link.getAttribute("href") : null;
                const dateM = text.match(/\\b(\\d{{1,2}}[.\\/]\\d{{1,2}}[.\\/]\\d{{4}}|\\d{{4}}-\\d{{2}}-\\d{{2}})\\b/);
                const dato = dateM ? dateM[0] : null;
                let title = text.replace(nummer, "").replace(dato || "", "").trim().replace(/\\s+/g, " ").replace(/^[·|–\\-\\s]+|[·|–\\-\\s]+$/g, "");
                results.push({{ nummer, title: title || null, dato, href }});
            }}
            return results;
        }}""")
        if result:
            docs = []
            for item in result:
                docs.append({
                    "type": doc_type,
                    "nummer": item.get("nummer"),
                    "title": item.get("title"),
                    "dato": item.get("dato"),
                    "href": item.get("href"),
                })
            log(verbose, f"  JS eval: {len(docs)} documents")
            return docs
    except Exception as exc:
        log(verbose, f"  JS eval error: {exc}")
    return []


# ---------------------------------------------------------------------------
# Page scraping with network interception
# ---------------------------------------------------------------------------

def scrape_document_list_page(
    page,
    doc_type: str,
    url: str,
    *,
    dump_html: bool = False,
    verbose: bool = False,
) -> list[dict[str, Any]]:
    """Navigate to a ft.dk document list page and extract all documents."""
    captured_json: list[dict[str, Any]] = []

    def handle_response(response) -> None:
        content_type = response.headers.get("content-type", "")
        if "json" not in content_type:
            return
        # Only capture API responses that look like document lists
        resp_url = response.url
        if not any(kw in resp_url for kw in ["api", "dokumentlister", "sager", "search", "list"]):
            return
        try:
            body = response.json()
            captured_json.append({"url": resp_url, "body": body})
            log(verbose, f"  captured JSON response: {resp_url}")
        except Exception:
            pass

    page.on("response", handle_response)

    try:
        log(verbose, f"navigating to {url}")
        page.goto(url, wait_until="networkidle", timeout=90000)

        if dump_html:
            html_path = DATA_DIR / f"ft_{doc_type.lower()}_page.html"
            html_path.write_text(page.content(), encoding="utf-8")
            log(True, f"HTML dumped to {html_path}")

        log(verbose, f"page title: {page.title()}")
        log(verbose, f"captured {len(captured_json)} JSON API responses")

        all_docs: list[dict[str, Any]] = []

        # ---- Try to parse JSON API responses ----
        for capture in captured_json:
            docs = try_parse_api_response(capture["body"], doc_type, verbose)
            if docs:
                all_docs.extend(docs)
                log(verbose, f"  API parse: {len(docs)} docs from {capture['url']}")

        if all_docs:
            log(verbose, f"API strategy succeeded: {len(all_docs)} documents")
            return all_docs

        # ---- Fallback: JS evaluation ----
        log(verbose, "API strategy yielded nothing — trying JS evaluation")
        docs = evaluate_dom_extraction(page, doc_type, verbose)
        if docs:
            return docs

        # ---- Fallback: DOM scraping ----
        log(verbose, "JS eval yielded nothing — trying DOM scraping")
        docs = try_extract_rows_from_dom(page, doc_type, verbose)
        if docs:
            return docs

        # ---- Last resort: log all visible text ----
        log(verbose, "all strategies failed — logging visible text for debugging")
        visible_text = page.evaluate("() => document.body.innerText")
        log(True, f"--- PAGE TEXT (first 2000 chars) ---\n{visible_text[:2000]}\n---")

        return []

    finally:
        try:
            page.remove_listener("response", handle_response)
        except Exception:
            pass


def try_parse_api_response(body: Any, doc_type: str, verbose: bool) -> list[dict[str, Any]]:
    """Attempt to extract document records from a JSON API response."""
    if not body:
        return []

    docs: list[dict[str, Any]] = []
    pattern = re.compile(rf"^{doc_type}\s+\d+$")

    def search_dict(obj: Any) -> None:
        if isinstance(obj, list):
            for item in obj:
                search_dict(item)
        elif isinstance(obj, dict):
            # Check if this dict looks like a document record
            nummer = None
            for key in ("nummer", "sagsnummer", "number", "id_text", "name"):
                val = str(obj.get(key) or "")
                if pattern.match(val.strip()):
                    nummer = val.strip()
                    break

            if nummer:
                title = None
                for key in ("titel", "title", "titelkort", "short_title", "name", "text"):
                    val = obj.get(key)
                    if val and isinstance(val, str) and len(val) > 5:
                        title = clean_text(val)
                        break

                dato = None
                for key in ("dato", "date", "created", "updated", "startdato"):
                    val = str(obj.get(key) or "")
                    if val and (re.match(r"\d{4}-\d{2}-\d{2}", val) or re.match(r"\d{1,2}[./]\d{1,2}[./]\d{4}", val)):
                        dato = val[:10]
                        break

                docs.append({
                    "type": doc_type,
                    "nummer": nummer,
                    "title": title,
                    "dato": dato,
                    "href": None,
                    "raw": {k: obj.get(k) for k in list(obj)[:10]},  # keep for debugging
                })
            else:
                for value in obj.values():
                    search_dict(value)

    search_dict(body)
    return docs


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------

def scrape_all_pages(
    page,
    doc_type: str,
    base_url: str,
    *,
    dump_html: bool = False,
    verbose: bool = False,
) -> list[dict[str, Any]]:
    """Scrape all pages of a document list, following pagination."""
    all_docs: list[dict[str, Any]] = []

    docs = scrape_document_list_page(page, doc_type, base_url, dump_html=dump_html, verbose=verbose)
    all_docs.extend(docs)

    # Try to find and follow pagination
    page_count = 1
    while True:
        next_btn = None
        for selector in [
            "a[aria-label='Næste']",
            "a[title='Næste']",
            "a:has-text('Næste')",
            "[class*='pagination'] a[class*='next']:not([class*='disabled'])",
            "[class*='pager'] a[class*='next']",
            "nav[aria-label*='aginering'] a:last-child",
        ]:
            try:
                btn = page.query_selector(selector)
                if btn and btn.is_visible() and btn.is_enabled():
                    next_btn = btn
                    log(verbose, f"found next-page button with '{selector}'")
                    break
            except Exception:
                continue

        if not next_btn:
            log(verbose, f"no more pages after page {page_count}")
            break

        page_count += 1
        log(verbose, f"navigating to page {page_count}")
        try:
            next_btn.click()
            page.wait_for_load_state("networkidle", timeout=30000)
        except PlaywrightTimeoutError:
            log(verbose, "timeout waiting for next page — stopping pagination")
            break

        new_docs = scrape_document_list_page(page, doc_type, page.url, dump_html=False, verbose=verbose)
        if not new_docs:
            log(verbose, "no documents on new page — stopping")
            break
        all_docs.extend(new_docs)

    log(verbose, f"{doc_type}: total {len(all_docs)} documents across {page_count} pages")
    return all_docs


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------

def deduplicate(docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for doc in docs:
        key = f"{doc.get('type')}|{doc.get('nummer')}"
        if key not in seen:
            seen.add(key)
            out.append(doc)
    return out


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
                docs = scrape_all_pages(
                    page,
                    doc_type,
                    url,
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

    # Deduplicate and strip debug fields before saving
    all_documents = deduplicate(all_documents)
    for doc in all_documents:
        doc.pop("raw", None)

    output_path.write_text(
        json.dumps(all_documents, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(json.dumps(
        {"ok": True, "total": len(all_documents), "output": str(output_path)},
        ensure_ascii=False,
    ))

    if args.verbose:
        for doc_type in types_to_scrape:
            count = sum(1 for d in all_documents if d["type"] == doc_type)
            print(f"  {doc_type}: {count}", file=sys.stderr)


if __name__ == "__main__":
    main()
