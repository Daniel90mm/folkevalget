#!/usr/bin/env python3
"""Fetch conservative CVR participant matches for Folkevalget profiles.

This script uses the public Virk/CVR frontend in a real Chrome session and
stores only exact single-person matches for each politician. Ambiguous name
hits are skipped on purpose to avoid false attribution.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import quote

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
PROFILES_FILE = DATA_DIR / "profiler.json"
OUTPUT_FILE = DATA_DIR / "cvr_personer.json"

CVR_BASE_URL = "https://datacvr.virk.dk"
DEBUG_PORT = 9235
DEFAULT_DELAY = 0.15

DEFAULT_CHROME_PATHS = (
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files\Chromium\Application\chrome.exe"),
)

STATUS_LABELS = {
    "NORMAL": "Normal",
    "OPHOERT": "Ophoert",
    "OPHOERT_": "Ophoert",
}

ROLE_FALLBACKS = {
    "erstdist-organisation-rolle-stiftere": "Stifter",
    "erstdist-organisation-rolle-legale_ejere": "Legal ejer",
    "erstdist-organisation-rolle-direktoerer": "Direktor",
    "erstdist-organisation-rolle-bestyrelse": "Bestyrelse",
    "erstdist-organisation-rolle-formand": "Formand",
    "erstdist-organisation-rolle-naestformand": "Naestformand",
    "erstdist-organisation-rolle-fuldt_ansvarlig_deltager": "Fuldt ansvarlig deltager",
}

EXTRA_LABEL_FALLBACKS = {
    "virksomhedsrelation-tiltraedelsesdato-label": "Tiltraedelsesdato",
    "virksomhedsrelation-fratraadt-label": "Fratraadt",
    "ejerandel-procent-label": "Ejerandel",
    "ejerandel-stemmeretprocent-label": "Stemmerettigheder",
    "ejerandel-aendringsdato-label": "Senest aendret",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(OUTPUT_FILE), help="Output JSON path.")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY, help="Delay between lookups in seconds.")
    parser.add_argument("--chrome-path", default="", help="Explicit path to chrome.exe.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch only the first 5 profiles.")
    parser.add_argument(
        "--retry-errors",
        action="store_true",
        help="Retry only profiles marked with an error in the existing output file.",
    )
    return parser.parse_args()


def find_chrome(explicit_path: str = "") -> str:
    if explicit_path:
        candidate = Path(explicit_path)
        if candidate.exists():
            return str(candidate)
        raise FileNotFoundError(f"Chrome not found: {explicit_path}")

    for candidate in DEFAULT_CHROME_PATHS:
        if candidate.exists():
            return str(candidate)

    raise FileNotFoundError("Could not find Chrome. Pass --chrome-path.")


def start_chrome(chrome_path: str, user_data_dir: Path, seed_url: str) -> subprocess.Popen[Any]:
    return subprocess.Popen(
        [
            chrome_path,
            f"--remote-debugging-port={DEBUG_PORT}",
            f"--user-data-dir={user_data_dir}",
            "--no-first-run",
            "--no-default-browser-check",
            seed_url,
        ]
    )


def normalise_name(value: str) -> str:
    normalised = unicodedata.normalize("NFKC", value or "").strip().lower()
    normalised = re.sub(r"\s+", " ", normalised)
    return normalised


def name_tokens(value: str) -> list[str]:
    return re.findall(r"[0-9a-zA-Z\u00C0-\u017F-]+", normalise_name(value))


def slug_status(value: str | None) -> str | None:
    if not value:
        return None
    slug = unicodedata.normalize("NFKD", value)
    slug = "".join(char for char in slug if not unicodedata.combining(char))
    slug = slug.upper().replace(" ", "_").replace("-", "_")
    return re.sub(r"[^A-Z_]", "", slug)


def format_status(value: str | None) -> str | None:
    if not value:
        return None
    slug = slug_status(value)
    if not slug:
        return value
    if slug in STATUS_LABELS:
        return STATUS_LABELS[slug]
    label = slug.replace("_", " ").strip().lower()
    return label[:1].upper() + label[1:] if label else value


def build_person_url(enhedsnummer: str, person_type: str) -> str:
    return f"{CVR_BASE_URL}/enhed/person/{enhedsnummer}/{person_type}"


def build_company_url(enhedsnummer: str) -> str:
    return f"{CVR_BASE_URL}/enhed/virksomhed/{enhedsnummer}"


def build_search_payload(name: str) -> dict[str, Any]:
    return {
        "fritekstCommand": {
            "soegOrd": name,
            "sideIndex": "0",
            "enhedstype": "",
            "kommune": [],
            "region": [],
            "antalAnsatte": [],
            "virksomhedsform": [],
            "virksomhedsstatus": [],
            "virksomhedsmarkering": [],
            "personrolle": [],
            "startdatoFra": "",
            "startdatoTil": "",
            "ophoersdatoFra": "",
            "ophoersdatoTil": "",
            "branchekode": "",
            "size": ["10"],
            "sortering": "",
        }
    }


def fetch_json(page: Any, path: str, method: str = "GET", payload: Any = None, retries: int = 3) -> Any:
    last_error: Exception | None = None
    script = """
async ({ path, method, payload }) => {
  const options = { method, headers: {} };
  if (payload !== null) {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify(payload);
  }
  const response = await fetch(path, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return await response.json();
}
"""
    for attempt in range(1, retries + 1):
        try:
            return page.evaluate(script, {"path": path, "method": method, "payload": payload})
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt == retries:
                break
            time.sleep(attempt)
    raise RuntimeError(f"Failed to fetch {path}: {last_error}") from last_error


def build_text_lookup(text_rows: list[dict[str, Any]]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for row in text_rows:
        if row.get("locale") == "da" and row.get("type") == "Text" and row.get("code") and row.get("message"):
            lookup[row["code"]] = row["message"]
    return lookup


def translate_role(code: str | None, text_lookup: dict[str, str]) -> str:
    if not code:
        return "Ukendt rolle"
    return text_lookup.get(code) or ROLE_FALLBACKS.get(code) or humanise_code(code)


def translate_extra_label(code: str | None, text_lookup: dict[str, str]) -> str:
    if not code:
        return "Detalje"
    return text_lookup.get(code) or EXTRA_LABEL_FALLBACKS.get(code) or humanise_code(code)


def humanise_code(code: str) -> str:
    label = code.rsplit("-", 1)[-1].replace("_", " ").strip().lower()
    return label[:1].upper() + label[1:] if label else code


def add_unique(values: list[str], value: str | None) -> None:
    if value and value not in values:
        values.append(value)


def add_fact(facts: list[dict[str, str]], label: str, value: str) -> None:
    for fact in facts:
        if fact["label"] == label and fact["value"] == value:
            return
    facts.append({"label": label, "value": value})


def merge_relations(relations: list[dict[str, Any]], text_lookup: dict[str, str]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}

    for relation in relations:
        key = relation.get("enhedsNummer") or relation.get("cvrnummer") or relation.get("senesteNavn") or "ukendt"
        entry = grouped.setdefault(
            key,
            {
                "company_name": relation.get("senesteNavn") or "Ukendt virksomhed",
                "company_enhedsnummer": relation.get("enhedsNummer"),
                "company_cvr": relation.get("cvrnummer") or "",
                "company_url": build_company_url(relation.get("enhedsNummer")) if relation.get("enhedsNummer") else "",
                "status": format_status(relation.get("virksomhedsstatus")),
                "roles": [],
                "facts": [],
            },
        )

        add_unique(entry["roles"], translate_role(relation.get("tekstnogle"), text_lookup))

        for fact in relation.get("ekstraDataList") or []:
            label = translate_extra_label(fact.get("tekstnogle"), text_lookup)
            value = str(fact.get("vaerdi") or "").strip()
            if value:
                add_fact(entry["facts"], label, value)

    return sorted(grouped.values(), key=lambda item: normalise_name(item["company_name"]))


def find_exact_person_matches(results: dict[str, Any], name: str) -> list[dict[str, Any]]:
    expected = normalise_name(name)
    return [
        entry
        for entry in results.get("enheder") or []
        if entry.get("enhedstype") == "person" and normalise_name(entry.get("senesteNavn", "")) == expected
    ]


def find_single_extended_name_match(results: dict[str, Any], name: str) -> dict[str, Any] | None:
    person_candidates = [entry for entry in results.get("enheder") or [] if entry.get("enhedstype") == "person"]
    if len(person_candidates) != 1:
        return None

    candidate = person_candidates[0]
    expected_tokens = name_tokens(name)
    candidate_tokens = name_tokens(candidate.get("senesteNavn", ""))
    if len(expected_tokens) < 2 or len(candidate_tokens) < len(expected_tokens):
        return None
    if expected_tokens[0] != candidate_tokens[0] or expected_tokens[-1] != candidate_tokens[-1]:
        return None

    index = 0
    for token in candidate_tokens:
        if index < len(expected_tokens) and token == expected_tokens[index]:
            index += 1
    return candidate if index == len(expected_tokens) else None


def build_no_match_entry(profile: dict[str, Any], results: dict[str, Any]) -> dict[str, Any]:
    person_candidates = [
        {
            "name": entry.get("senesteNavn") or "",
            "person_enhedsnummer": entry.get("enhedsnummer") or "",
            "person_type": entry.get("personType") or "",
            "person_url": (
                build_person_url(entry.get("enhedsnummer"), entry.get("personType"))
                if entry.get("enhedsnummer") and entry.get("personType")
                else ""
            ),
        }
        for entry in results.get("enheder") or []
        if entry.get("enhedstype") == "person"
    ]
    return {
        "id": profile["id"],
        "name": profile["name"],
        "status": "not_found",
        "person_total": int(results.get("personTotal") or len(person_candidates)),
        "candidates": person_candidates,
    }


def build_ambiguous_entry(profile: dict[str, Any], matches: list[dict[str, Any]], results: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": profile["id"],
        "name": profile["name"],
        "status": "ambiguous",
        "person_total": int(results.get("personTotal") or 0),
        "exact_match_count": len(matches),
        "candidates": [
            {
                "name": match.get("senesteNavn") or "",
                "person_enhedsnummer": match.get("enhedsnummer") or "",
                "person_type": match.get("personType") or "",
                "has_active_relations": bool(match.get("harAktiveRelationer")),
                "person_url": (
                    build_person_url(match.get("enhedsnummer"), match.get("personType"))
                    if match.get("enhedsnummer") and match.get("personType")
                    else ""
                ),
            }
            for match in matches
        ],
    }


def fetch_profile_entry(page: Any, profile: dict[str, Any], text_lookup: dict[str, str]) -> dict[str, Any]:
    search_results = fetch_json(page, "/gateway/soeg/fritekst", method="POST", payload=build_search_payload(profile["name"]))
    matches = find_exact_person_matches(search_results, profile["name"])
    match_quality = "exact"

    if len(matches) == 0:
        extended_match = find_single_extended_name_match(search_results, profile["name"])
        if not extended_match:
            return build_no_match_entry(profile, search_results)
        matches = [extended_match]
        match_quality = "extended_name"

    if len(matches) > 1:
        return build_ambiguous_entry(profile, matches, search_results)

    match = matches[0]
    person_enhedsnummer = str(match.get("enhedsnummer") or "")
    person_type = str(match.get("personType") or "deltager")
    person_url = build_person_url(person_enhedsnummer, person_type)

    entry: dict[str, Any] = {
        "id": profile["id"],
        "name": profile["name"],
        "status": "exact_match",
        "match_quality": match_quality,
        "person_name": match.get("senesteNavn") or profile["name"],
        "person_enhedsnummer": person_enhedsnummer,
        "person_type": person_type,
        "person_url": person_url,
        "search_url": f"{CVR_BASE_URL}/soegeresultater?fritekst={quote(profile['name'])}&sideIndex=0&size=10",
        "has_active_relations": bool(match.get("harAktiveRelationer")),
        "active_relations": [],
        "historical_relation_count": 0,
    }

    if not match.get("harAktiveRelationer"):
        return entry

    detail = fetch_json(
        page,
        f"/gateway/person/hentPerson?enhedsnummer={person_enhedsnummer}&persontype={person_type}&locale=da",
    )
    person_relations = detail.get("personRelationer") or {}
    active_relations = person_relations.get("aktiveRelationer") or []
    inactive_relations = person_relations.get("ophoerteRelationer") or []

    entry["active_relations"] = merge_relations(active_relations, text_lookup)
    entry["historical_relation_count"] = len(inactive_relations)
    return entry


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_profiles(args: argparse.Namespace) -> list[dict[str, Any]]:
    profiles = json.loads(PROFILES_FILE.read_text(encoding="utf-8"))
    if args.retry_errors and Path(args.output).exists():
        existing = json.loads(Path(args.output).read_text(encoding="utf-8")).get("medlemmer", {})
        retry_ids = {key for key, value in existing.items() if value.get("status") == "error"}
        profiles = [profile for profile in profiles if str(profile["id"]) in retry_ids]
    if args.dry_run:
        profiles = profiles[:5]
    return profiles


def load_existing_output(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def main() -> None:
    args = parse_args()
    output_path = Path(args.output)
    profiles = load_profiles(args)
    existing_output = load_existing_output(output_path)

    chrome_path = find_chrome(args.chrome_path)
    user_data_dir = (ROOT / "tmp_chrome_cvr_profile").resolve()
    if user_data_dir.exists():
        shutil.rmtree(user_data_dir, ignore_errors=True)
    user_data_dir.mkdir(parents=True, exist_ok=True)

    seed_url = CVR_BASE_URL
    process = start_chrome(chrome_path, user_data_dir, seed_url)

    output: dict[str, Any] = {
        "generated": str(date.today()),
        "note": (
            "Data bygger paa praecis navnesoegning i det offentlige CVR paa Virk. "
            "Kun entydige persontraef gemmes. Navne med ekstra mellemnavne accepteres kun ved et enkelt persontraef. "
            "Tvetydige eller usikre navnetraef skjules."
        ),
        "medlemmer": dict(existing_output.get("medlemmer", {})),
    }

    try:
        time.sleep(8)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{DEBUG_PORT}")
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()
            try:
                page.wait_for_load_state("networkidle", timeout=60000)
            except PlaywrightTimeoutError:
                pass

            text_rows = fetch_json(page, "/gateway/tekst")
            text_lookup = build_text_lookup(text_rows)

            total = len(profiles)
            for index, profile in enumerate(profiles, start=1):
                try:
                    entry = fetch_profile_entry(page, profile, text_lookup)
                except Exception as exc:  # noqa: BLE001
                    entry = {
                        "id": profile["id"],
                        "name": profile["name"],
                        "status": "error",
                        "error": str(exc),
                    }

                output["medlemmer"][str(profile["id"])] = entry
                write_json(output_path, output)

                status = entry.get("status")
                active_count = len(entry.get("active_relations") or [])
                print(f"[{index}/{total}] {profile['name']} -> {status} ({active_count} aktive relationer)")
                if index < total and args.delay > 0:
                    time.sleep(args.delay)

            browser.close()
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except Exception:  # noqa: BLE001
            process.kill()
        shutil.rmtree(user_data_dir, ignore_errors=True)

    print(f"Skrev {output_path}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
