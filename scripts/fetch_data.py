#!/usr/bin/env python3
"""Fetch Folketinget ODA data and build static JSON for GitHub Pages."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import html
import json
import re
import sys
import time
import unicodedata
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


BASE_URL = "https://oda.ft.dk/api"
PAGE_SIZE = 100
DEFAULT_DELAY = 0.2
DEFAULT_START_DATE = "2022-11-01"
DEFAULT_RECENT_VOTES = 10
REQUEST_TIMEOUT = 60
MAX_RETRIES = 3
PHOTO_CREDITS_FILENAME = "credits.json"
TIMELINE_SHARD_COUNT = 32
VOTE_DETAIL_SHARD_COUNT = 32

DA_MONTHS = {
    "januar": 1,
    "februar": 2,
    "marts": 3,
    "april": 4,
    "maj": 5,
    "juni": 6,
    "juli": 7,
    "august": 8,
    "september": 9,
    "oktober": 10,
    "november": 11,
    "december": 12,
}

WIKIDATA_HEADERS = {
    "User-Agent": "folkevalget-data-fetcher/1.0 (https://folkevalget.dk)",
    "Accept": "application/json",
}

WIKIDATA_POSITIVE_DESC_KEYWORDS = (
    "politician",
    "parliamentarian",
    "member of the folketing",
    "member of parliament",
    "politiker",
    "folketingsmedlem",
    "minister",
    "borgmester",
)
WIKIDATA_POSITIVE_NATIONALITY_KEYWORDS = (
    "danish",
    "dansk",
    "greenlandic",
    "grønlandsk",
    "faroese",
    "færøsk",
)
WIKIDATA_NEGATIVE_DESC_KEYWORDS = (
    "album",
    "song",
    "bay",
    "film",
    "tv series",
    "footballer",
    "handball",
    "racewalker",
    "cyclist",
    "disambiguation",
)
WIKIDATA_SEARCH_CACHE: dict[tuple[str, str], list[dict[str, Any]]] = {}
WIKIDATA_ENTITY_CACHE: dict[str, dict[str, Any]] = {}


@dataclass
class FetchOptions:
    delay: float
    page_size: int
    verbose: bool


class OdaClient:
    def __init__(self, options: FetchOptions) -> None:
        self.options = options

    def get_json(self, endpoint: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        query = encode_query(params or {})
        url = f"{BASE_URL}/{endpoint}"
        if query:
            url = f"{url}?{query}"
        return self.get_json_url(url)

    def get_json_url(self, url: str) -> dict[str, Any]:
        last_error: Exception | None = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                request = Request(
                    url,
                    headers={
                        "Accept": "application/json",
                        "User-Agent": "folkevalget-data-fetcher/1.0",
                    },
                )
                with urlopen(request, timeout=REQUEST_TIMEOUT) as response:
                    return json.load(response)
            except (HTTPError, URLError, TimeoutError) as exc:
                last_error = exc
                if attempt == MAX_RETRIES:
                    break
                sleep_for = attempt * 1.5
                log(self.options.verbose, f"retry {attempt}/{MAX_RETRIES} for {url} in {sleep_for:.1f}s")
                time.sleep(sleep_for)

        raise RuntimeError(f"failed to fetch {url}: {last_error}") from last_error

    def fetch_collection(
        self,
        endpoint: str,
        *,
        params: dict[str, Any] | None = None,
        label: str | None = None,
    ) -> list[dict[str, Any]]:
        base_params = dict(params or {})
        items: list[dict[str, Any]] = []
        skip = 0

        while True:
            page_params = dict(base_params)
            page_params.update(
                {
                    "$format": "json",
                    "$top": self.options.page_size,
                    "$skip": skip,
                }
            )
            payload = self.get_json(endpoint, page_params)
            page_items = payload.get("value", [])
            if not page_items:
                break

            items.extend(page_items)
            if label:
                log(self.options.verbose, f"{label}: fetched {len(items)} rows")

            if len(page_items) < self.options.page_size:
                break

            skip += self.options.page_size
            time.sleep(self.options.delay)

        return items


def encode_query(params: dict[str, Any]) -> str:
    parts: list[str] = []
    for key, value in params.items():
        if value is None:
            continue
        encoded_value = quote(str(value), safe="(),'/:$")
        parts.append(f"{key}={encoded_value}")
    return "&".join(parts)


def log(verbose: bool, message: str) -> None:
    if verbose:
        print(message, file=sys.stderr)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default="data", help="Directory for derived site JSON.")
    parser.add_argument(
        "--raw-dir",
        default="data/raw",
        help="Directory for optional raw snapshots.",
    )
    parser.add_argument(
        "--start-date",
        default=DEFAULT_START_DATE,
        help="Fetch votes and case context from this date (YYYY-MM-DD).",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY,
        help="Delay between paginated ODA requests in seconds.",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=PAGE_SIZE,
        help="Rows per ODA request.",
    )
    parser.add_argument(
        "--recent-votes",
        type=int,
        default=DEFAULT_RECENT_VOTES,
        help="Recent votes to keep per member profile.",
    )
    parser.add_argument(
        "--vote-workers",
        type=int,
        default=6,
        help="Parallel workers for overflow vote-record pages.",
    )
    parser.add_argument(
        "--write-raw",
        action="store_true",
        help="Write raw snapshot files to raw-dir.",
    )
    parser.add_argument(
        "--skip-photos",
        action="store_true",
        help="Skip applying locally cached portrait files from photos/.",
    )
    parser.add_argument(
        "--photo-workers",
        type=int,
        default=2,
        help="Unused legacy flag kept for CLI compatibility.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print progress logs.",
    )
    parser.add_argument(
        "--timelines-only",
        action="store_true",
        help="Refresh only sag timelines from existing afstemninger.json.",
    )
    return parser.parse_args()


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, payload: Any) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_json_compact(path: Path, payload: Any) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def write_json_shards(directory: Path, shards: dict[str, list[dict[str, Any]]]) -> None:
    ensure_dir(directory)
    for existing_file in directory.glob("*.json"):
        existing_file.unlink()
    for shard_key, payload in sorted(shards.items(), key=lambda item: item[0]):
        write_json_compact(directory / f"{shard_key}.json", payload)


def write_profile_vote_id_files(
    directory: Path,
    *,
    profiles: list[dict[str, Any]],
    vote_ids_by_person: dict[int, dict[str, list[int]]],
) -> None:
    ensure_dir(directory)
    valid_profile_ids: set[int] = set()
    for profile in profiles:
        person_id = int(profile.get("id") or 0)
        if person_id <= 0:
            continue
        valid_profile_ids.add(person_id)
        write_json_compact(
            directory / f"{person_id}.json",
            vote_ids_by_person.get(
                person_id,
                {
                    "for": [],
                    "imod": [],
                    "fravaer": [],
                    "hverken": [],
                },
            ),
        )

    for existing_file in directory.glob("*.json"):
        stem = existing_file.stem
        if stem.isdigit() and int(stem) not in valid_profile_ids:
            existing_file.unlink()


def write_javascript_payload(path: Path, variable_name: str, payload: Any) -> None:
    ensure_dir(path.parent)
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    path.write_text(f"window.{variable_name}={serialized};\n", encoding="utf-8")


def parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None

    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        pass

    dash_match = re.match(r"^(\d{1,2})-(\d{1,2})-(\d{4})$", value)
    if dash_match:
        day, month, year = (int(part) for part in dash_match.groups())
        return date(year, month, day)

    month_match = re.match(r"^(\d{1,2})\.\s*([A-Za-zÆØÅæøå]+)\s+(\d{4})$", value)
    if month_match:
        day = int(month_match.group(1))
        month_name = month_match.group(2).lower()
        year = int(month_match.group(3))
        month = DA_MONTHS.get(month_name)
        if month:
            return date(year, month, day)

    return None


def round_pct(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return round((numerator / denominator) * 100, 1)


def completed_months_between(start_date: date | None, end_date: date) -> int | None:
    if not start_date:
        return None

    months = (end_date.year - start_date.year) * 12 + (end_date.month - start_date.month)
    if end_date.day < start_date.day:
        months -= 1
    return max(months, 0)


def format_seniority_label(start_date: date | None, end_date: date) -> tuple[str | None, int | None, int | None]:
    months = completed_months_between(start_date, end_date)
    if months is None:
        return None, None, None

    years = months // 12
    if months < 12:
        return "Under 1 aar i Folketinget", 0, months
    if years == 1:
        return "1 aar i Folketinget", years, months
    return f"{years} aar i Folketinget", years, months


def seniority_tag_key(start_date: date | None, end_date: date) -> str | None:
    months = completed_months_between(start_date, end_date)
    if months is None:
        return None
    return "newcomer" if months < 48 else "experienced"


def extract_tag(blob: str | None, tag: str) -> str | None:
    if not blob:
        return None
    match = re.search(rf"<{tag}>(.*?)</{tag}>", blob, flags=re.DOTALL)
    if not match:
        return None
    text = re.sub(r"<[^>]+>", "", match.group(1))
    text = html.unescape(text).strip()
    return text or None


def parse_biography_xml(blob: str | None) -> ET.Element | None:
    if not blob:
        return None
    try:
        return ET.fromstring(blob)
    except ET.ParseError:
        return None


def normalize_biography_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = html.unescape(value).replace("\xa0", " ")
    value = re.sub(r"\s+", " ", value).strip()
    return value or None


def xml_text(root: ET.Element | None, path: str) -> str | None:
    if root is None:
        return None
    node = root.find(path)
    if node is None:
        return None
    text = " ".join(fragment.strip() for fragment in node.itertext() if fragment and fragment.strip())
    return normalize_biography_text(text)


def xml_text_list(root: ET.Element | None, path: str) -> list[str]:
    if root is None:
        return []

    values: list[str] = []
    for node in root.findall(path):
        text = " ".join(fragment.strip() for fragment in node.itertext() if fragment and fragment.strip())
        cleaned = normalize_biography_text(text)
        if cleaned:
            values.append(cleaned)
    return values


def normalize_member_url(raw_url: str | None) -> str | None:
    if not raw_url:
        return None
    if raw_url.startswith("http://") or raw_url.startswith("https://"):
        return raw_url
    if raw_url.startswith("/"):
        return f"https://www.ft.dk{raw_url}"
    return f"https://www.ft.dk/{raw_url.lstrip('/')}"


def normalize_photo_url(raw_url: str | None) -> str | None:
    if not raw_url:
        return None
    raw_url = raw_url.strip()
    if not raw_url:
        return None
    if raw_url.lower().endswith(".zip"):
        return None
    if raw_url.startswith("http://") or raw_url.startswith("https://"):
        return raw_url
    if raw_url.startswith("/"):
        return f"https://www.ft.dk{raw_url}"
    return f"https://www.ft.dk/{raw_url.lstrip('/')}"


def normalize_name_text(value: str | None) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKD", value.lower())
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return " ".join(normalized.split())


def effective_membership_dates(membership: dict[str, Any]) -> tuple[date | None, date | None]:
    start_candidates = [
        membership.get("relation_start"),
        membership.get("actor_start"),
    ]
    end_candidates = [
        membership.get("relation_end"),
        membership.get("actor_end"),
    ]
    start_dates = [value for value in start_candidates if value]
    end_dates = [value for value in end_candidates if value]
    start_date = max(start_dates) if start_dates else None
    end_date = min(end_dates) if end_dates else None
    return start_date, end_date


def build_party_history(
    memberships: list[dict[str, Any]],
    *,
    on_date: date,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []

    for membership in sorted(memberships, key=membership_sort_key, reverse=True):
        actor = membership["actor"]
        start_date, end_date = effective_membership_dates(membership)
        item = {
            "party": actor.get("navn"),
            "party_short": actor.get("gruppenavnkort"),
            "start_date": start_date.isoformat() if start_date else None,
            "end_date": end_date.isoformat() if end_date else None,
            "active": membership_active_on(membership, on_date),
        }
        if not items:
            items.append(item)
            continue

        previous = items[-1]
        same_party = (
            previous.get("party_short") == item.get("party_short")
            and previous.get("party") == item.get("party")
        )
        if same_party and can_merge_party_history(previous, item):
            items[-1] = merge_party_history_entries(previous, item)
        else:
            items.append(item)

    return items


def can_merge_party_history(left: dict[str, Any], right: dict[str, Any]) -> bool:
    left_start = parse_iso_date(left.get("start_date"))
    right_end = parse_iso_date(right.get("end_date"))

    if left_start and right_end:
        return right_end >= left_start
    return True


def merge_party_history_entries(newer: dict[str, Any], older: dict[str, Any]) -> dict[str, Any]:
    newer_start = parse_iso_date(newer.get("start_date"))
    older_start = parse_iso_date(older.get("start_date"))
    newer_end = parse_iso_date(newer.get("end_date"))
    older_end = parse_iso_date(older.get("end_date"))

    merged_start_candidates = [value for value in (newer_start, older_start) if value]
    merged_end_candidates = [value for value in (newer_end, older_end) if value]

    merged_start = min(merged_start_candidates) if merged_start_candidates else None
    merged_end = max(merged_end_candidates) if merged_end_candidates else None

    return {
        "party": newer.get("party") or older.get("party"),
        "party_short": newer.get("party_short") or older.get("party_short"),
        "start_date": merged_start.isoformat() if merged_start else None,
        "end_date": None if newer.get("active") or older.get("active") else (merged_end.isoformat() if merged_end else None),
        "active": newer.get("active") or older.get("active"),
    }


def find_local_photo_path(person_id: int, photos_dir: Path) -> str | None:
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        candidate = photos_dir / f"{person_id}{ext}"
        if candidate.exists():
            return f"photos/{person_id}{ext}"
    return None


def load_photo_credit_manifest(photos_dir: Path) -> dict[int, dict[str, Any]]:
    manifest_path = photos_dir / PHOTO_CREDITS_FILENAME
    if not manifest_path.exists():
        return {}
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return {}

    manifest: dict[int, dict[str, Any]] = {}
    for raw_id, entry in payload.items():
        try:
            person_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if isinstance(entry, dict):
            manifest[person_id] = entry
    return manifest


def apply_local_photo_inventory(profiles: list[dict[str, Any]], photos_dir: Path) -> None:
    photo_manifest = load_photo_credit_manifest(photos_dir)
    for profile in profiles:
        local_photo_url = find_local_photo_path(profile["id"], photos_dir)
        if local_photo_url:
            profile["photo_url"] = local_photo_url

        credit_entry = photo_manifest.get(profile["id"]) or {}
        if local_photo_url and not profile.get("photo_source_name"):
            profile["photo_source_name"] = "Folketinget"

        if credit_entry.get("file"):
            profile["photo_url"] = credit_entry["file"]
        if credit_entry.get("member_url"):
            profile["member_url"] = credit_entry["member_url"]
        if credit_entry.get("source_url"):
            profile["photo_source_url"] = credit_entry["source_url"]
        if credit_entry.get("source_name"):
            profile["photo_source_name"] = credit_entry["source_name"]
        if credit_entry.get("photographer"):
            profile["photo_photographer"] = credit_entry["photographer"]
        if credit_entry.get("credit_text"):
            profile["photo_credit_text"] = credit_entry["credit_text"]
        elif local_photo_url and profile.get("photo_source_name"):
            profile["photo_credit_text"] = profile["photo_source_name"]


def build_filter_for_ids(field: str, ids: list[int]) -> str:
    return " or ".join(f"{field} eq {item}" for item in ids)


def collect_lookup_map(rows: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    return {int(row["id"]): row for row in rows}


def row_value(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key not in row:
            continue
        value = row.get(key)
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


def membership_sort_key(membership: dict[str, Any]) -> tuple[date, int]:
    relation_start = membership.get("relation_start") or date.min
    actor_start = membership.get("actor_start") or date.min
    return (max(relation_start, actor_start), int(membership["actor"]["id"]))


def membership_active_on(membership: dict[str, Any], on_date: date) -> bool:
    relation_start = membership.get("relation_start")
    relation_end = membership.get("relation_end")
    actor_start = membership.get("actor_start")
    actor_end = membership.get("actor_end")

    if relation_start and on_date < relation_start:
        return False
    if relation_end and on_date > relation_end:
        return False
    if actor_start and on_date < actor_start:
        return False
    if actor_end and on_date > actor_end:
        return False
    return True


def choose_latest_active(
    memberships: list[dict[str, Any]],
    on_date: date,
) -> dict[str, Any] | None:
    active = [membership for membership in memberships if membership_active_on(membership, on_date)]
    if not active:
        return None
    active.sort(key=membership_sort_key, reverse=True)
    return active[0]


def build_biography_fields(person: dict[str, Any]) -> dict[str, Any]:
    biography = person.get("biografi")
    root = parse_biography_xml(biography)
    constituency_entries = xml_text_list(root, ".//career/constituencies/constituency")
    constituency = constituency_entries[0] if constituency_entries else None
    return {
        "member_url": normalize_member_url(xml_text(root, ".//url") or extract_tag(biography, "url")),
        "photo_url": normalize_photo_url(xml_text(root, ".//pictureMiRes"))
        or normalize_photo_url(xml_text(root, ".//pictureHiRes"))
        or normalize_photo_url(extract_tag(biography, "pictureMiRes"))
        or normalize_photo_url(extract_tag(biography, "pictureHiRes")),
        "profession": xml_text(root, ".//profession") or extract_tag(biography, "profession"),
        "title": xml_text(root, ".//title") or extract_tag(biography, "title"),
        "current_constituency": constituency,
        "constituency_history": constituency_entries,
        "party_short_from_bio": xml_text(root, ".//partyShortname") or extract_tag(biography, "partyShortname"),
        "function_start_date": parse_iso_date(
            xml_text(root, ".//personalInformation/function/functionStartDate")
            or extract_tag(biography, "functionStartDate")
        ),
        "educations": xml_text_list(root, ".//educations/education"),
        "occupations": xml_text_list(root, ".//occupations/occupation"),
        "email": xml_text(root, ".//emails/email"),
        "phone": (
            xml_text(root, ".//mobilePhone")
            or xml_text(root, ".//ministerPhone")
            or xml_text(root, ".//phoneFolketinget")
            or xml_text(root, ".//privatePhone")
        ),
        "website_url": xml_text(root, ".//Websites/WebsiteUrl/Url"),
        "address": xml_text(root, ".//addresses/address"),
    }


def extract_constituency_label(raw_text: str | None) -> str | None:
    if not raw_text:
        return None

    cleaned = " ".join(raw_text.replace("\xa0", " ").split())
    match = re.search(r"i ([^.]+?)(?: fra |, )", cleaned)
    if match:
        label = match.group(1).strip()
    else:
        label = cleaned

    label = re.sub(r"^i\s+", "", label).strip(" .")
    return label or None


def determine_vote_window(
    client: OdaClient,
    *,
    start_date: str,
    today_iso: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    filter_expr = (
        f"dato ge datetime'{start_date}T00:00:00' "
        f"and dato le datetime'{today_iso}T23:59:59' and Afstemning/any()"
    )
    earliest_payload = client.get_json(
        "Sagstrin",
        {
            "$filter": filter_expr,
            "$orderby": "dato asc",
            "$expand": "Afstemning",
            "$top": 1,
            "$format": "json",
        },
    )
    earliest_rows = earliest_payload.get("value", [])
    if not earliest_rows:
        raise RuntimeError(f"no voted sagstrin rows found from {start_date}")

    earliest_row = earliest_rows[0]
    earliest_votes = earliest_row.get("Afstemning", [])
    if not earliest_votes:
        raise RuntimeError(f"earliest voted sagstrin row from {start_date} had no votes attached")

    earliest_vote_id = min(int(item["id"]) for item in earliest_votes)

    sagstrin_rows = client.fetch_collection(
        "Sagstrin",
        params={
            "$filter": filter_expr,
            "$orderby": "dato asc",
            "$expand": "Afstemning,Afstemning/Stemme,Sag,Sagstrinstype,Sagstrinsstatus",
        },
        label="sagstrin",
    )
    return (
        {
            "start_date": start_date,
            "today": today_iso,
            "first_vote_id": earliest_vote_id,
            "first_sagstrin_id": int(earliest_row["id"]),
            "sagstrin_count": len(sagstrin_rows),
        },
        sagstrin_rows,
    )


def fetch_sag_documents(
    client: OdaClient,
    *,
    sag_ids: list[int],
) -> list[dict[str, Any]]:
    if not sag_ids:
        return []

    max_documents_per_sag = 8
    workers = 8
    rows: list[dict[str, Any]] = []

    def _fetch_one_sag(sag_id: int) -> list[dict[str, Any]]:
        payload = client.get_json(
            "SagDokument",
            {
                "$filter": f"sagid eq {sag_id}",
                "$orderby": "id desc",
                "$top": max_documents_per_sag,
                "$expand": "Dokument/Fil,SagDokumentRolle",
                "$format": "json",
            },
        )
        return payload.get("value", [])

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(_fetch_one_sag, sag_id): sag_id for sag_id in sag_ids}
        completed = 0
        for future in as_completed(futures):
            rows.extend(future.result())
            completed += 1
            if client.options.verbose and (completed % 100 == 0 or completed == len(sag_ids)):
                log(True, f"sagdokument: {completed}/{len(sag_ids)} sager")

    return rows


def fetch_sag_actor_rows(
    client: OdaClient,
    *,
    sag_ids: list[int],
) -> list[dict[str, Any]]:
    if not sag_ids:
        return []

    rows: list[dict[str, Any]] = []
    chunk_size = 40
    for start in range(0, len(sag_ids), chunk_size):
        chunk = sag_ids[start : start + chunk_size]
        filter_expr = build_filter_for_ids("sagid", chunk)
        rows.extend(
            client.fetch_collection(
                "SagAkt%C3%B8r",
                params={"$filter": filter_expr},
                label="sag-aktorer",
            )
        )
        time.sleep(client.options.delay)

    deduped = {int(row["id"]): row for row in rows}
    return list(deduped.values())


def fetch_sagstrin_for_sager(
    client: OdaClient,
    *,
    sag_ids: list[int],
    start_date: str | None = None,
    today_iso: str | None = None,
) -> list[dict[str, Any]]:
    if not sag_ids:
        return []

    rows: list[dict[str, Any]] = []
    chunk_size = 20

    for start in range(0, len(sag_ids), chunk_size):
        chunk = sag_ids[start : start + chunk_size]
        sag_filter = build_filter_for_ids("sagid", chunk)
        filters = [f"({sag_filter})"]
        if start_date and today_iso:
            filters.append(
                f"dato ge datetime'{start_date}T00:00:00' and dato le datetime'{today_iso}T23:59:59'"
            )
        elif start_date:
            filters.append(f"dato ge datetime'{start_date}T00:00:00'")
        elif today_iso:
            filters.append(f"dato le datetime'{today_iso}T23:59:59'")

        rows.extend(
            client.fetch_collection(
                "Sagstrin",
                params={
                    "$filter": " and ".join(filters),
                    "$orderby": "dato asc,id asc",
                    "$expand": "Sag,Sagstrinstype,Sagstrinsstatus,Afstemning",
                },
                label="sagstrin-timeline",
            )
        )
        time.sleep(client.options.delay)

    deduped = {int(row["id"]): row for row in rows}
    return sorted(deduped.values(), key=lambda item: ((item.get("dato") or ""), int(item["id"])))


def fetch_sagstrin_documents(
    client: OdaClient,
    *,
    sagstrin_ids: list[int],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    chunk_size = 40
    for start in range(0, len(sagstrin_ids), chunk_size):
        chunk = sagstrin_ids[start : start + chunk_size]
        filter_expr = build_filter_for_ids("sagstrinid", chunk)
        rows.extend(
            client.fetch_collection(
                "SagstrinDokument",
                params={
                    "$filter": filter_expr,
                    "$expand": "Dokument/Fil",
                },
                label="sagstrin-dokument",
            )
        )
        time.sleep(client.options.delay)
    return rows


def fetch_dokument_actor_rows(
    client: OdaClient,
    *,
    document_ids: list[int],
) -> list[dict[str, Any]]:
    if not document_ids:
        return []

    rows: list[dict[str, Any]] = []
    chunk_size = 40
    for start in range(0, len(document_ids), chunk_size):
        chunk = document_ids[start : start + chunk_size]
        filter_expr = build_filter_for_ids("dokumentid", chunk)
        rows.extend(
            client.fetch_collection(
                "DokumentAkt%C3%B8r",
                params={"$filter": filter_expr},
                label="dokument-aktorer",
            )
        )
        time.sleep(client.options.delay)

    deduped = {int(row["id"]): row for row in rows}
    return list(deduped.values())


def fetch_sager_by_ids(
    client: OdaClient,
    *,
    sag_ids: list[int],
) -> list[dict[str, Any]]:
    if not sag_ids:
        return []

    rows: list[dict[str, Any]] = []
    chunk_size = 40
    for start in range(0, len(sag_ids), chunk_size):
        chunk = sag_ids[start : start + chunk_size]
        filter_expr = build_filter_for_ids("id", chunk)
        rows.extend(
            client.fetch_collection(
                "Sag",
                params={
                    "$filter": filter_expr,
                    "$top": len(chunk),
                },
                label="sag",
            )
        )
        time.sleep(client.options.delay)

    deduped = {int(row["id"]): row for row in rows}
    return list(deduped.values())


def fetch_dagsordenspunkt_rows(
    client: OdaClient,
    *,
    sagstrin_ids: list[int],
) -> list[dict[str, Any]]:
    if not sagstrin_ids:
        return []

    rows: list[dict[str, Any]] = []
    chunk_size = 40
    for start in range(0, len(sagstrin_ids), chunk_size):
        chunk = sagstrin_ids[start : start + chunk_size]
        filter_expr = build_filter_for_ids("sagstrinid", chunk)
        rows.extend(
            client.fetch_collection(
                "Dagsordenspunkt",
                params={"$filter": filter_expr},
                label="dagsordenspunkter",
            )
        )
        time.sleep(client.options.delay)

    deduped = {int(row["id"]): row for row in rows}
    return list(deduped.values())


def fetch_moeder_by_ids(client: OdaClient, *, moede_ids: list[int]) -> list[dict[str, Any]]:
    if not moede_ids:
        return []

    rows: list[dict[str, Any]] = []
    chunk_size = 40
    for start in range(0, len(moede_ids), chunk_size):
        chunk = moede_ids[start : start + chunk_size]
        filter_expr = build_filter_for_ids("id", chunk)
        rows.extend(
            client.fetch_collection(
                "M%C3%B8de",
                params={"$filter": filter_expr},
                label="moeder",
            )
        )
        time.sleep(client.options.delay)

    deduped = {int(row["id"]): row for row in rows}
    return list(deduped.values())


def fetch_sagstrin_by_ids(
    client: OdaClient,
    *,
    sagstrin_ids: list[int],
) -> list[dict[str, Any]]:
    if not sagstrin_ids:
        return []

    rows: list[dict[str, Any]] = []
    chunk_size = 40
    for start in range(0, len(sagstrin_ids), chunk_size):
        chunk = sagstrin_ids[start : start + chunk_size]
        filter_expr = build_filter_for_ids("id", chunk)
        rows.extend(
            client.fetch_collection(
                "Sagstrin",
                params={
                    "$filter": filter_expr,
                    "$expand": "Sag,Sagstrinstype,Sagstrinsstatus,Afstemning",
                    "$top": len(chunk),
                },
                label="sagstrin-lookup",
            )
        )
        time.sleep(client.options.delay)

    deduped = {int(row["id"]): row for row in rows}
    return list(deduped.values())


def fetch_sambehandling_rows(
    client: OdaClient,
    *,
    sagstrin_ids: list[int],
) -> list[dict[str, Any]]:
    if not sagstrin_ids:
        return []

    rows: list[dict[str, Any]] = []
    chunk_size = 20
    for start in range(0, len(sagstrin_ids), chunk_size):
        chunk = sagstrin_ids[start : start + chunk_size]
        first_filter = build_filter_for_ids("førstesagstrinid", chunk)
        second_filter = build_filter_for_ids("andetsagstrinid", chunk)
        rows.extend(
            client.fetch_collection(
                "Sambehandlinger",
                params={
                    "$filter": f"({first_filter}) or ({second_filter})",
                },
                label="sambehandlinger",
            )
        )
        time.sleep(client.options.delay)

    deduped = {int(row["id"]): row for row in rows}
    return list(deduped.values())


def fetch_omtryk_rows(
    client: OdaClient,
    *,
    document_ids: list[int],
) -> list[dict[str, Any]]:
    if not document_ids:
        return []

    rows: list[dict[str, Any]] = []
    chunk_size = 40
    for start in range(0, len(document_ids), chunk_size):
        chunk = document_ids[start : start + chunk_size]
        filter_expr = build_filter_for_ids("dokumentid", chunk)
        rows.extend(
            client.fetch_collection(
                "Omtryk",
                params={"$filter": filter_expr},
                label="omtryk",
            )
        )
        time.sleep(client.options.delay)
    return rows


def fetch_emneordsag_rows(
    client: OdaClient,
    *,
    sag_ids: list[int],
) -> list[dict[str, Any]]:
    if not sag_ids:
        return []

    rows: list[dict[str, Any]] = []
    chunk_size = 40
    for start in range(0, len(sag_ids), chunk_size):
        chunk = sag_ids[start : start + chunk_size]
        filter_expr = build_filter_for_ids("sagid", chunk)
        rows.extend(
            client.fetch_collection(
                "EmneordSag",
                params={"$filter": filter_expr},
                label="emneord-sag",
            )
        )
        time.sleep(client.options.delay)
    return rows


def fetch_emneorddokument_rows(
    client: OdaClient,
    *,
    document_ids: list[int],
) -> list[dict[str, Any]]:
    if not document_ids:
        return []

    rows: list[dict[str, Any]] = []
    chunk_size = 40
    for start in range(0, len(document_ids), chunk_size):
        chunk = document_ids[start : start + chunk_size]
        filter_expr = build_filter_for_ids("dokumentid", chunk)
        rows.extend(
            client.fetch_collection(
                "EmneordDokument",
                params={"$filter": filter_expr},
                label="emneord-dokument",
            )
        )
        time.sleep(client.options.delay)
    return rows


def fetch_emneord_rows(
    client: OdaClient,
    *,
    emneord_ids: list[int],
) -> list[dict[str, Any]]:
    if not emneord_ids:
        return []

    rows: list[dict[str, Any]] = []
    chunk_size = 60
    for start in range(0, len(emneord_ids), chunk_size):
        chunk = emneord_ids[start : start + chunk_size]
        filter_expr = build_filter_for_ids("id", chunk)
        rows.extend(
            client.fetch_collection(
                "Emneord",
                params={"$filter": filter_expr, "$top": len(chunk)},
                label="emneord",
            )
        )
        time.sleep(client.options.delay)

    deduped = {int(row["id"]): row for row in rows}
    return list(deduped.values())


def compute_min_period_kode(start_date: str) -> str:
    """Return the minimum Periode kode that covers start_date.

    Danish parliamentary years run Oct–Sep, so the kode for the session starting
    in October YYYY is f"{YYYY}1" (first session of that year).
    """
    d = date.fromisoformat(start_date)
    start_year = d.year if d.month >= 10 else d.year - 1
    return f"{start_year}1"


def fetch_rf_sager(
    client: OdaClient,
    *,
    min_period_kode: str,
) -> list[dict[str, Any]]:
    """Fetch Forespørgsel (F, typeid=2) and Redegørelse (R, typeid=11) sager
    from the ODA API for sessions with kode >= min_period_kode.

    Returns a list in the same format as data/ft_dokumenter_rf.json.
    """
    log(client.options.verbose, f"fetching Periode records (kode >= {min_period_kode})")
    periode_rows = client.fetch_collection(
        "Periode",
        params={
            "$filter": f"type eq 'samling' and kode ge '{min_period_kode}'",
            "$orderby": "kode desc",
        },
        label="periode",
    )
    if not periode_rows:
        log(client.options.verbose, "no Periode records found; skipping RF sager")
        return []

    periode_by_id: dict[int, dict[str, Any]] = {int(row["id"]): row for row in periode_rows}
    period_id_filter = build_filter_for_ids("periodeid", list(periode_by_id.keys()))

    log(client.options.verbose, f"fetching F/R sager across {len(periode_rows)} sessions")
    sag_rows = client.fetch_collection(
        "Sag",
        params={
            "$filter": (
                f"(typeid eq 2 or typeid eq 11)"
                f" and ({period_id_filter})"
                f" and nummernumerisk ne ''"
            ),
            "$orderby": "periodeid desc,id desc",
        },
        label="rf-sager",
    )

    type_map = {2: "F", 11: "R"}
    type_path_map = {2: "forespoergsel", 11: "redegorelse"}
    documents: list[dict[str, Any]] = []
    seen: set[str] = set()

    for row in sag_rows:
        typeid = int(row.get("typeid") or 0)
        doc_type = type_map.get(typeid)
        nummer = (row.get("nummer") or "").strip() or None
        if not nummer or not doc_type:
            continue

        key = f"{doc_type}|{nummer}"
        if key in seen:
            continue
        seen.add(key)

        periode = periode_by_id.get(int(row.get("periodeid") or 0)) or {}
        periode_kode = (periode.get("kode") or "").strip()
        samling = (periode.get("titel") or "").strip() or None
        num_part = (row.get("nummernumerisk") or "").strip()
        type_path = type_path_map[typeid]
        href = (
            f"/samling/{periode_kode}/{type_path}/{doc_type}{num_part}/index.htm"
            if periode_kode and num_part
            else None
        )

        titel = (row.get("titelkort") or row.get("titel") or "").strip() or None
        documents.append({
            "nummer": nummer,
            "titel": titel,
            "afgivet_af": None,
            "forespoergere": None,
            "status": None,
            "samling": samling,
            "href": href,
            "type": doc_type,
        })

    log(client.options.verbose, f"RF sager: {len(documents)} unique documents")
    return documents


def fetch_actor_relations_for_sources(
    client: OdaClient,
    *,
    source_actor_ids: list[int],
    start_date: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    chunk_size = 20
    active_filter = f"(slutdato eq null or slutdato ge datetime'{start_date}T00:00:00')"

    for start in range(0, len(source_actor_ids), chunk_size):
        chunk = source_actor_ids[start : start + chunk_size]
        source_filter = build_filter_for_ids("fraaktørid", chunk)
        rows.extend(
            client.fetch_collection(
                "Akt%C3%B8rAkt%C3%B8r",
                params={"$filter": f"({source_filter}) and {active_filter}"},
                label="aktor-aktor",
            )
        )
        time.sleep(client.options.delay)

    deduped = {int(row["id"]): row for row in rows}
    return list(deduped.values())


def fetch_people_by_ids(client: OdaClient, *, person_ids: list[int]) -> list[dict[str, Any]]:
    if not person_ids:
        return []

    rows: list[dict[str, Any]] = []
    chunk_size = 50
    for start in range(0, len(person_ids), chunk_size):
        chunk = person_ids[start : start + chunk_size]
        id_filter = build_filter_for_ids("id", chunk)
        rows.extend(
            client.fetch_collection(
                "Akt%C3%B8r",
                params={"$filter": f"typeid eq 5 and ({id_filter})"},
                label="people",
            )
        )
        time.sleep(client.options.delay)

    deduped = {int(row["id"]): row for row in rows}
    return list(deduped.values())


def fetch_actors_by_ids(client: OdaClient, *, actor_ids: list[int]) -> list[dict[str, Any]]:
    if not actor_ids:
        return []

    rows: list[dict[str, Any]] = []
    chunk_size = 50
    for start in range(0, len(actor_ids), chunk_size):
        chunk = actor_ids[start : start + chunk_size]
        id_filter = build_filter_for_ids("id", chunk)
        rows.extend(
            client.fetch_collection(
                "Akt%C3%B8r",
                params={"$filter": id_filter},
                label="actors",
            )
        )
        time.sleep(client.options.delay)

    deduped = {int(row["id"]): row for row in rows}
    return list(deduped.values())


def _fetch_vote_stem_overflow(
    client: OdaClient,
    *,
    vote_id: int,
    next_url: str,
) -> tuple[int, list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    url = next_url

    while url:
        payload = client.get_json_url(url)
        page_rows = payload.get("value", [])
        rows.extend(page_rows)
        url = payload.get("odata.nextLink")
        if url:
            time.sleep(client.options.delay)

    return vote_id, rows


def extract_vote_records(
    client: OdaClient,
    *,
    sagstrin_rows: list[dict[str, Any]],
    max_workers: int,
) -> list[dict[str, Any]]:
    stems: list[dict[str, Any]] = []
    overflow_jobs: list[tuple[int, str]] = []

    for sagstrin_row in sagstrin_rows:
        for vote_row in sagstrin_row.get("Afstemning") or []:
            vote_id = int(vote_row["id"])
            embedded_stems = vote_row.pop("Stemme", []) or []
            stems.extend(embedded_stems)

            next_link = vote_row.pop("Stemme@odata.nextLink", None)
            if next_link:
                overflow_jobs.append((vote_id, next_link))

    if not overflow_jobs:
        return stems

    log(
        client.options.verbose,
        f"fetching overflow vote pages for {len(overflow_jobs)} afstemninger with up to {max_workers} workers",
    )

    workers = max(1, max_workers)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [
            executor.submit(_fetch_vote_stem_overflow, client, vote_id=vote_id, next_url=next_url)
            for vote_id, next_url in overflow_jobs
        ]
        completed = 0
        for future in as_completed(futures):
            vote_id, rows = future.result()
            stems.extend(rows)
            completed += 1
            if client.options.verbose and (completed % 50 == 0 or completed == len(overflow_jobs)):
                log(
                    True,
                    f"overflow stems: completed {completed}/{len(overflow_jobs)} afstemninger",
                )

    return stems


def build_memberships(
    actor_relations: list[dict[str, Any]],
    actors_by_id: dict[int, dict[str, Any]],
    person_ids: set[int],
) -> tuple[dict[int, list[dict[str, Any]]], dict[int, list[dict[str, Any]]]]:
    party_memberships: dict[int, list[dict[str, Any]]] = defaultdict(list)
    committee_memberships: dict[int, list[dict[str, Any]]] = defaultdict(list)

    for relation in actor_relations:
        person_id = int(relation.get("tilaktørid") or 0)
        actor_id = int(relation.get("fraaktørid") or 0)
        if person_id not in person_ids:
            continue

        actor = actors_by_id.get(actor_id)
        if not actor:
            continue

        actor_type = int(actor["typeid"])
        if actor_type not in {3, 4}:
            continue

        membership = {
            "actor": actor,
            "relation_id": int(relation["id"]),
            "relation_start": parse_iso_date(relation.get("startdato")),
            "relation_end": parse_iso_date(relation.get("slutdato")),
            "actor_start": parse_iso_date(actor.get("startdato")),
            "actor_end": parse_iso_date(actor.get("slutdato")),
            "role_id": relation.get("rolleid"),
        }

        if actor_type == 4:
            party_memberships[person_id].append(membership)
        else:
            committee_memberships[person_id].append(membership)

    for memberships in party_memberships.values():
        memberships.sort(key=membership_sort_key, reverse=True)
    for memberships in committee_memberships.values():
        memberships.sort(key=membership_sort_key, reverse=True)

    return party_memberships, committee_memberships


def select_primary_document_file(files: list[dict[str, Any]]) -> dict[str, Any] | None:
    for file_row in files:
        url = str(file_row.get("filurl") or "")
        if url.lower().endswith(".pdf"):
            return file_row

    for file_row in files:
        fmt = str(file_row.get("format") or "")
        if "pdf" in fmt.lower() and file_row.get("filurl"):
            return file_row

    for file_row in files:
        if file_row.get("filurl"):
            return file_row

    return None


def make_document_links(
    sag_document_rows: list[dict[str, Any]],
    *,
    omtryk_by_document_id: dict[int, list[dict[str, Any]]] | None = None,
) -> dict[int, list[dict[str, Any]]]:
    omtryk_by_document_id = omtryk_by_document_id or {}
    links_by_sag: dict[int, list[dict[str, Any]]] = defaultdict(list)

    for row in sag_document_rows:
        sag_id = int(row["sagid"])
        document = row.get("Dokument") or {}
        file_row = select_primary_document_file(document.get("Fil") or [])
        if not file_row:
            continue

        url = file_row.get("filurl")
        if not url:
            continue

        role = (row.get("SagDokumentRolle") or {}).get("rolle")
        document_id = int(document["id"])
        omtryk_entries = omtryk_by_document_id.get(document_id, [])
        title_text = str(document.get("titel") or "")
        is_omtryk = bool(omtryk_entries) or ("omtryk" in title_text.lower()) or ("omtryk" in str(url).lower())
        links_by_sag[sag_id].append(
            {
                "document_id": document_id,
                "title": document.get("titel"),
                "number": document.get("nummer"),
                "date": (document.get("dato") or document.get("frigivelsesdato") or row.get("frigivelsesdato") or "")[:10] or None,
                "role": role,
                "url": url,
                "format": file_row.get("format"),
                "variant_code": file_row.get("variantkode"),
                "is_omtryk": is_omtryk,
                "omtryk": omtryk_entries[:3],
            }
        )

    deduped: dict[int, list[dict[str, Any]]] = {}
    for sag_id, links in links_by_sag.items():
        seen: set[str] = set()
        unique_links: list[dict[str, Any]] = []
        for link in links:
            url = str(link["url"])
            if url in seen:
                continue
            seen.add(url)
            unique_links.append(link)
        deduped[sag_id] = unique_links
    return deduped


def make_sagstrin_document_links(
    sagstrin_document_rows: list[dict[str, Any]],
    *,
    omtryk_by_document_id: dict[int, list[dict[str, Any]]] | None = None,
) -> dict[int, list[dict[str, Any]]]:
    omtryk_by_document_id = omtryk_by_document_id or {}
    links_by_sagstrin: dict[int, list[dict[str, Any]]] = defaultdict(list)

    for row in sagstrin_document_rows:
        sagstrin_id = int(row["sagstrinid"])
        document = row.get("Dokument") or {}
        file_row = select_primary_document_file(document.get("Fil") or [])
        if not file_row:
            continue

        url = file_row.get("filurl")
        if not url:
            continue

        document_id = int(document["id"])
        omtryk_entries = omtryk_by_document_id.get(document_id, [])
        title_text = str(document.get("titel") or "")
        is_omtryk = bool(omtryk_entries) or ("omtryk" in title_text.lower()) or ("omtryk" in str(url).lower())
        links_by_sagstrin[sagstrin_id].append(
            {
                "document_id": document_id,
                "title": document.get("titel"),
                "number": document.get("nummer"),
                "date": (document.get("dato") or document.get("frigivelsesdato") or "")[:10] or None,
                "url": url,
                "format": file_row.get("format"),
                "variant_code": file_row.get("variantkode"),
                "is_omtryk": is_omtryk,
                "omtryk": omtryk_entries[:3],
            }
        )

    deduped: dict[int, list[dict[str, Any]]] = {}
    for sagstrin_id, links in links_by_sagstrin.items():
        seen: set[str] = set()
        unique_links: list[dict[str, Any]] = []
        for link in links:
            url = str(link["url"])
            if url in seen:
                continue
            seen.add(url)
            unique_links.append(link)
        deduped[sagstrin_id] = unique_links
    return deduped


def make_case_document_links_from_sagstrin(
    *,
    sagstrin_rows: list[dict[str, Any]],
    stage_document_links_by_sagstrin: dict[int, list[dict[str, Any]]],
) -> dict[int, list[dict[str, Any]]]:
    sag_by_stage = {int(row["id"]): int(row["sagid"]) for row in sagstrin_rows}
    links_by_sag: dict[int, list[dict[str, Any]]] = defaultdict(list)

    for sagstrin_id, links in stage_document_links_by_sagstrin.items():
        sag_id = sag_by_stage.get(sagstrin_id)
        if not sag_id:
            continue
        links_by_sag[sag_id].extend(links)

    deduped: dict[int, list[dict[str, Any]]] = {}
    for sag_id, links in links_by_sag.items():
        seen: set[str] = set()
        unique_links: list[dict[str, Any]] = []
        for link in links:
            url = str(link.get("url") or "")
            if not url or url in seen:
                continue
            seen.add(url)
            unique_links.append(link)
        deduped[sag_id] = unique_links

    return deduped


def collect_document_ids(
    *,
    sag_document_rows: list[dict[str, Any]],
    sagstrin_document_rows: list[dict[str, Any]],
) -> list[int]:
    ids: set[int] = set()
    for row in sag_document_rows:
        document = row.get("Dokument") or {}
        if document.get("id") is not None:
            ids.add(int(document["id"]))
    for row in sagstrin_document_rows:
        document = row.get("Dokument") or {}
        if document.get("id") is not None:
            ids.add(int(document["id"]))
    return sorted(ids)


def build_omtryk_map(omtryk_rows: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    by_document: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in omtryk_rows:
        document_id = int(row.get("dokumentid") or 0)
        if document_id <= 0:
            continue
        by_document[document_id].append(
            {
                "id": int(row.get("id") or 0),
                "date": (row.get("dato") or "")[:10] or None,
                "reason": row.get("begrundelse") or None,
            }
        )

    for document_id, entries in by_document.items():
        entries.sort(key=lambda item: ((item.get("date") or ""), item.get("id") or 0))
        by_document[document_id] = entries
    return dict(by_document)


def build_emneord_lookup(
    emneord_rows: list[dict[str, Any]],
    emneordstype_rows: list[dict[str, Any]],
) -> dict[int, dict[str, Any]]:
    type_lookup = {int(row["id"]): row.get("type") for row in emneordstype_rows if row.get("id") is not None}
    emneord_lookup: dict[int, dict[str, Any]] = {}
    for row in emneord_rows:
        emneord_id = int(row["id"])
        type_id = int(row.get("typeid") or 0)
        emneord_lookup[emneord_id] = {
            "id": emneord_id,
            "emneord": row.get("emneord"),
            "type_id": type_id or None,
            "type": type_lookup.get(type_id),
        }
    return emneord_lookup


def build_sag_emneord_map(
    emneordsag_rows: list[dict[str, Any]],
    emneord_lookup: dict[int, dict[str, Any]],
) -> dict[int, list[dict[str, Any]]]:
    by_sag: dict[int, dict[int, dict[str, Any]]] = defaultdict(dict)
    for row in emneordsag_rows:
        sag_id = int(row.get("sagid") or 0)
        emneord_id = int(row.get("emneordid") or 0)
        if sag_id <= 0 or emneord_id <= 0:
            continue
        emneord = emneord_lookup.get(emneord_id)
        if not emneord:
            continue
        by_sag[sag_id][emneord_id] = emneord

    result: dict[int, list[dict[str, Any]]] = {}
    for sag_id, emneord_items in by_sag.items():
        result[sag_id] = sorted(
            emneord_items.values(),
            key=lambda item: ((item.get("type") or ""), (item.get("emneord") or "")),
        )
    return result


def build_document_emneord_map(
    emneorddokument_rows: list[dict[str, Any]],
    emneord_lookup: dict[int, dict[str, Any]],
) -> dict[int, list[dict[str, Any]]]:
    by_document: dict[int, dict[int, dict[str, Any]]] = defaultdict(dict)
    for row in emneorddokument_rows:
        document_id = int(row.get("dokumentid") or 0)
        emneord_id = int(row.get("emneordid") or 0)
        if document_id <= 0 or emneord_id <= 0:
            continue
        emneord = emneord_lookup.get(emneord_id)
        if not emneord:
            continue
        by_document[document_id][emneord_id] = emneord

    result: dict[int, list[dict[str, Any]]] = {}
    for document_id, emneord_items in by_document.items():
        result[document_id] = sorted(
            emneord_items.values(),
            key=lambda item: ((item.get("type") or ""), (item.get("emneord") or "")),
        )
    return result


def build_related_cases_by_sag(
    *,
    primary_sag_ids: list[int],
    sag_rows_by_id: dict[int, dict[str, Any]],
    sagstrin_rows: list[dict[str, Any]],
    sambehandling_rows: list[dict[str, Any]],
) -> dict[int, list[dict[str, Any]]]:
    relations: dict[int, dict[int, set[str]]] = defaultdict(lambda: defaultdict(set))

    for sag_id in primary_sag_ids:
        sag = sag_rows_by_id.get(sag_id) or {}
        fremsat_under_sag_id = int(sag.get("fremsatundersagid") or 0)
        delt_under_sag_id = int(sag.get("deltundersagid") or 0)

        if fremsat_under_sag_id > 0 and fremsat_under_sag_id != sag_id:
            relations[sag_id][fremsat_under_sag_id].add("Fremsat under")
            relations[fremsat_under_sag_id][sag_id].add("Har undersag")

        if delt_under_sag_id > 0 and delt_under_sag_id != sag_id:
            relations[sag_id][delt_under_sag_id].add("Delt under")
            relations[delt_under_sag_id][sag_id].add("Har delsag")

    sag_by_sagstrin = {int(row["id"]): int(row["sagid"]) for row in sagstrin_rows if row.get("id") is not None}
    for row in sambehandling_rows:
        first_id = int(row.get("førstesagstrinid") or 0)
        second_id = int(row.get("andetsagstrinid") or 0)
        first_sag_id = sag_by_sagstrin.get(first_id)
        second_sag_id = sag_by_sagstrin.get(second_id)
        if not first_sag_id or not second_sag_id or first_sag_id == second_sag_id:
            continue
        relations[first_sag_id][second_sag_id].add("Sambehandlet")
        relations[second_sag_id][first_sag_id].add("Sambehandlet")

    result: dict[int, list[dict[str, Any]]] = {}
    for sag_id in primary_sag_ids:
        related_entries: list[dict[str, Any]] = []
        for related_sag_id, relation_types in relations.get(sag_id, {}).items():
            related_sag = sag_rows_by_id.get(related_sag_id) or {}
            related_entries.append(
                {
                    "sag_id": related_sag_id,
                    "sag_number": related_sag.get("nummer"),
                    "sag_title": related_sag.get("titel"),
                    "sag_short_title": related_sag.get("titelkort"),
                    "relations": sorted(relation_types),
                }
            )
        related_entries.sort(
            key=lambda item: (
                item.get("sag_number") or "",
                item.get("sag_short_title") or item.get("sag_title") or "",
                item.get("sag_id") or 0,
            )
        )
        result[sag_id] = related_entries
    return result


def collect_document_records(
    *,
    sag_document_rows: list[dict[str, Any]],
    sagstrin_document_rows: list[dict[str, Any]],
) -> dict[int, dict[str, Any]]:
    by_id: dict[int, dict[str, Any]] = {}
    for row in sag_document_rows + sagstrin_document_rows:
        document = row.get("Dokument") or {}
        document_id = int(document.get("id") or 0)
        if document_id <= 0 or document_id in by_id:
            continue
        by_id[document_id] = document
    return by_id


def build_id_label_lookup(rows: list[dict[str, Any]], value_key: str) -> dict[int, str]:
    lookup: dict[int, str] = {}
    for row in rows:
        row_id = int(row.get("id") or 0)
        if row_id <= 0:
            continue
        value = str(row.get(value_key) or "").strip()
        if value:
            lookup[row_id] = value
    return lookup


def build_sag_actor_roles_by_sag(
    *,
    sag_actor_rows: list[dict[str, Any]],
    sag_actor_role_lookup: dict[int, str],
    actors_by_id: dict[int, dict[str, Any]],
    actor_type_lookup: dict[int, str],
) -> dict[int, list[dict[str, Any]]]:
    by_sag: dict[int, dict[tuple[int, int], dict[str, Any]]] = defaultdict(dict)
    for row in sag_actor_rows:
        sag_id = int(row.get("sagid") or 0)
        if sag_id <= 0:
            continue
        role_id = int(row.get("rolleid") or 0)
        actor_id = int(
            row_value(
                row,
                "aktørid",
                "akt\u00f8rid",
                "aktør_id",
                "akt\u00f8r_id",
                "aktoerid",
                "aktoer_id",
            )
            or 0
        )
        actor = actors_by_id.get(actor_id) or {}
        actor_type_id = int(actor.get("typeid") or 0)
        dedupe_key = (actor_id, role_id)
        by_sag[sag_id][dedupe_key] = {
            "actor_id": actor_id or None,
            "name": actor.get("navn"),
            "short_name": actor.get("gruppenavnkort"),
            "type_id": actor_type_id or None,
            "type": actor_type_lookup.get(actor_type_id),
            "role_id": role_id or None,
            "role": sag_actor_role_lookup.get(role_id),
        }

    result: dict[int, list[dict[str, Any]]] = {}
    for sag_id, entries in by_sag.items():
        result[sag_id] = sorted(
            entries.values(),
            key=lambda item: (
                item.get("role") or "",
                item.get("name") or "",
                item.get("actor_id") or 0,
            ),
        )
    return result


def collect_document_actor_ids(document_actor_rows: list[dict[str, Any]]) -> list[int]:
    actor_ids: set[int] = set()
    for row in document_actor_rows:
        actor_id = int(
            row_value(
                row,
                "aktørid",
                "akt\u00f8rid",
                "aktør_id",
                "akt\u00f8r_id",
                "aktoerid",
                "aktoer_id",
            )
            or 0
        )
        if actor_id > 0:
            actor_ids.add(actor_id)
    return sorted(actor_ids)


def dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        cleaned = str(value or "").strip()
        if not cleaned:
            continue
        key = cleaned.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(cleaned)
    return result


def build_document_question_chain(actor_entries: list[dict[str, Any]]) -> dict[str, list[str]]:
    askers: list[str] = []
    responders: list[str] = []
    for entry in actor_entries:
        role_text = str(entry.get("role") or "").lower()
        actor_name = str(entry.get("name") or "").strip()
        if not actor_name:
            continue
        if ("spørg" in role_text) or ("spoerg" in role_text) or ("spm" in role_text):
            askers.append(actor_name)
        if ("svar" in role_text) or ("besvar" in role_text):
            responders.append(actor_name)
    return {
        "askers": dedupe_strings(askers),
        "responders": dedupe_strings(responders),
    }


def build_document_provenance_map(
    *,
    document_actor_rows: list[dict[str, Any]],
    document_actor_role_lookup: dict[int, str],
    actors_by_id: dict[int, dict[str, Any]],
    actor_type_lookup: dict[int, str],
    document_rows_by_id: dict[int, dict[str, Any]],
    document_type_lookup: dict[int, str],
    document_status_lookup: dict[int, str],
    document_category_lookup: dict[int, str],
) -> dict[int, dict[str, Any]]:
    actors_by_document: dict[int, dict[tuple[int, int], dict[str, Any]]] = defaultdict(dict)
    for row in document_actor_rows:
        document_id = int(row.get("dokumentid") or 0)
        if document_id <= 0:
            continue
        role_id = int(row.get("rolleid") or 0)
        actor_id = int(
            row_value(
                row,
                "aktørid",
                "akt\u00f8rid",
                "aktør_id",
                "akt\u00f8r_id",
                "aktoerid",
                "aktoer_id",
            )
            or 0
        )
        actor = actors_by_id.get(actor_id) or {}
        actor_type_id = int(actor.get("typeid") or 0)
        dedupe_key = (actor_id, role_id)
        actors_by_document[document_id][dedupe_key] = {
            "actor_id": actor_id or None,
            "name": actor.get("navn"),
            "short_name": actor.get("gruppenavnkort"),
            "type_id": actor_type_id or None,
            "type": actor_type_lookup.get(actor_type_id),
            "role_id": role_id or None,
            "role": document_actor_role_lookup.get(role_id),
        }

    provenance_by_document: dict[int, dict[str, Any]] = {}
    for document_id, document in document_rows_by_id.items():
        doc_type_id = int(document.get("typeid") or 0)
        doc_status_id = int(document.get("statusid") or 0)
        doc_category_id = int(document.get("kategoriid") or 0)
        actors = sorted(
            actors_by_document.get(document_id, {}).values(),
            key=lambda item: (
                item.get("role") or "",
                item.get("name") or "",
                item.get("actor_id") or 0,
            ),
        )
        provenance_by_document[document_id] = {
            "document_type_id": doc_type_id or None,
            "document_type": document_type_lookup.get(doc_type_id),
            "document_status_id": doc_status_id or None,
            "document_status": document_status_lookup.get(doc_status_id),
            "document_category_id": doc_category_id or None,
            "document_category": document_category_lookup.get(doc_category_id),
            "document_actors": actors,
            "question_chain": build_document_question_chain(actors),
        }

    return provenance_by_document


def enrich_document_links_with_provenance(
    links_by_group: dict[int, list[dict[str, Any]]],
    document_provenance_by_document_id: dict[int, dict[str, Any]],
) -> dict[int, list[dict[str, Any]]]:
    enriched: dict[int, list[dict[str, Any]]] = {}
    for group_id, links in links_by_group.items():
        enriched_links: list[dict[str, Any]] = []
        for link in links:
            document_id = int(link.get("document_id") or 0)
            provenance = document_provenance_by_document_id.get(document_id, {})
            enriched_links.append(
                {
                    **link,
                    **provenance,
                }
            )
        enriched[group_id] = enriched_links
    return enriched


def build_meeting_context_by_sagstrin(
    *,
    dagsordenspunkt_rows: list[dict[str, Any]],
    moede_rows_by_id: dict[int, dict[str, Any]],
    moede_type_lookup: dict[int, str],
    moede_status_lookup: dict[int, str],
) -> dict[int, list[dict[str, Any]]]:
    def agenda_number_sort_value(raw_value: Any) -> tuple[int, int, str]:
        value = str(raw_value or "").strip()
        if not value:
            return (0, 0, "")
        if value.isdigit():
            return (0, int(value), value)
        numeric_prefix = re.match(r"^(\d+)", value)
        if numeric_prefix:
            return (1, int(numeric_prefix.group(1)), value.lower())
        return (2, 0, value.lower())

    by_sagstrin: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in dagsordenspunkt_rows:
        sagstrin_id = int(row.get("sagstrinid") or 0)
        if sagstrin_id <= 0:
            continue
        moede_id = int(
            row_value(
                row,
                "mødeid",
                "m\u00f8deid",
                "moedeid",
            )
            or 0
        )
        moede = moede_rows_by_id.get(moede_id) or {}
        moede_type_id = int(moede.get("typeid") or 0)
        moede_status_id = int(moede.get("statusid") or 0)
        by_sagstrin[sagstrin_id].append(
            {
                "dagsordenspunkt_id": int(row.get("id") or 0),
                "agenda_number": row.get("nummer"),
                "agenda_title": row.get("titel"),
                "forhandling": row.get("forhandling") or row.get("forhandlingskode"),
                "meeting": {
                    "id": moede_id or None,
                    "date": (moede.get("dato") or "")[:10] or None,
                    "number": moede.get("nummer"),
                    "title": moede.get("titel"),
                    "type": moede_type_lookup.get(moede_type_id),
                    "status": moede_status_lookup.get(moede_status_id),
                    "start_note": moede.get("starttidsbemærkning"),
                    "agenda_url": moede.get("dagsordenurl"),
                },
            }
        )

    for sagstrin_id, agenda_items in by_sagstrin.items():
        agenda_items.sort(
            key=lambda item: (
                (item.get("meeting") or {}).get("date") or "",
                int((item.get("meeting") or {}).get("number") or 0),
                agenda_number_sort_value(item.get("agenda_number")),
                item.get("dagsordenspunkt_id") or 0,
            )
        )
        by_sagstrin[sagstrin_id] = agenda_items

    return dict(by_sagstrin)


def build_meeting_overview(case_timelines: list[dict[str, Any]]) -> dict[str, Any]:
    def agenda_number_sort_value(raw_value: Any) -> tuple[int, int, str]:
        value = str(raw_value or "").strip()
        if not value:
            return (0, 0, "")
        if value.isdigit():
            return (0, int(value), value)
        numeric_prefix = re.match(r"^(\d+)", value)
        if numeric_prefix:
            return (1, int(numeric_prefix.group(1)), value.lower())
        return (2, 0, value.lower())

    def parse_numeric_prefix(raw_value: Any) -> int:
        value = str(raw_value or "").strip()
        if not value:
            return 0
        if value.isdigit():
            return int(value)
        numeric_prefix = re.match(r"^(\d+)", value)
        if numeric_prefix:
            return int(numeric_prefix.group(1))
        return 0

    meetings_by_id: dict[int, dict[str, Any]] = {}
    seen_agenda_keys_by_meeting: dict[int, set[str]] = defaultdict(set)
    agenda_point_count = 0

    for timeline in case_timelines:
        sag_id = int(timeline.get("sag_id") or 0)
        sag_number = timeline.get("sag_number")
        sag_title = timeline.get("sag_short_title") or timeline.get("sag_title")
        steps = timeline.get("steps") if isinstance(timeline.get("steps"), list) else []

        for step in steps:
            sagstrin_id = int(step.get("sagstrin_id") or 0)
            vote_ids = [int(vote_id) for vote_id in (step.get("vote_ids") or []) if int(vote_id or 0) > 0]
            agenda_items = step.get("agenda_items") if isinstance(step.get("agenda_items"), list) else []

            for agenda_item in agenda_items:
                meeting = agenda_item.get("meeting") or {}
                meeting_id = int(meeting.get("id") or 0)
                if meeting_id <= 0:
                    continue

                meeting_entry = meetings_by_id.get(meeting_id)
                if not meeting_entry:
                    meeting_entry = {
                        "meeting_id": meeting_id,
                        "date": meeting.get("date"),
                        "number": meeting.get("number"),
                        "title": meeting.get("title"),
                        "type": meeting.get("type"),
                        "status": meeting.get("status"),
                        "start_note": meeting.get("start_note"),
                        "agenda_url": meeting.get("agenda_url"),
                        "agenda_points": [],
                    }
                    meetings_by_id[meeting_id] = meeting_entry
                else:
                    for field in (
                        "date",
                        "number",
                        "title",
                        "type",
                        "status",
                        "start_note",
                        "agenda_url",
                    ):
                        if not meeting_entry.get(field) and meeting.get(field):
                            meeting_entry[field] = meeting.get(field)

                agenda_point_id = int(agenda_item.get("dagsordenspunkt_id") or 0)
                dedupe_key_parts = [
                    str(agenda_point_id or ""),
                    str(agenda_item.get("agenda_number") or ""),
                    str(agenda_item.get("agenda_title") or ""),
                    str(sagstrin_id or ""),
                    str(sag_id or ""),
                ]
                dedupe_key = "||".join(dedupe_key_parts)
                if dedupe_key in seen_agenda_keys_by_meeting[meeting_id]:
                    continue
                seen_agenda_keys_by_meeting[meeting_id].add(dedupe_key)

                meeting_entry["agenda_points"].append(
                    {
                        "agenda_point_id": agenda_point_id or None,
                        "agenda_number": agenda_item.get("agenda_number"),
                        "agenda_title": agenda_item.get("agenda_title"),
                        "forhandling": agenda_item.get("forhandling"),
                        "sag_id": sag_id or None,
                        "sag_number": sag_number,
                        "sag_title": sag_title,
                        "sagstrin_id": sagstrin_id or None,
                        "sagstrin_date": step.get("date"),
                        "sagstrin_title": step.get("title"),
                        "sagstrin_type": step.get("type"),
                        "sagstrin_status": step.get("status"),
                        "vote_ids": vote_ids,
                    }
                )
                agenda_point_count += 1

    meetings: list[dict[str, Any]] = []
    for meeting in meetings_by_id.values():
        points = meeting.get("agenda_points") if isinstance(meeting.get("agenda_points"), list) else []
        points.sort(
            key=lambda item: (
                agenda_number_sort_value(item.get("agenda_number")),
                item.get("sagstrin_date") or "",
                item.get("agenda_point_id") or 0,
                item.get("sagstrin_id") or 0,
            )
        )
        meeting["agenda_points"] = points
        meeting["agenda_point_count"] = len(points)
        meetings.append(meeting)

    meetings.sort(
        key=lambda item: (
            item.get("date") or "",
            parse_numeric_prefix(item.get("number")),
            item.get("meeting_id") or 0,
        ),
        reverse=True,
    )

    return {
        "scope": "case-linked-meetings",
        "scope_note": "Moeder og dagsordenspunkter koblet til sager i det aktuelle datasaet.",
        "counts": {
            "meetings": len(meetings),
            "agenda_points": agenda_point_count,
        },
        "meetings": meetings,
    }


def build_vote_context(
    sagstrin_rows: list[dict[str, Any]],
    document_links_by_sag: dict[int, list[dict[str, Any]]],
    afstemningstype_lookup: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    votes: list[dict[str, Any]] = []

    for row in sagstrin_rows:
        sag = row.get("Sag") or {}
        sag_id = int(row["sagid"])
        sag_documents = document_links_by_sag.get(sag_id, [])
        sag_type = row.get("Sagstrinstype") or {}
        sag_status = row.get("Sagstrinsstatus") or {}
        vote_rows = row.get("Afstemning") or []

        for vote_row in vote_rows:
            vote_type_id = int(vote_row.get("typeid") or 0)
            votes.append(
                {
                    "afstemning_id": int(vote_row["id"]),
                    "nummer": vote_row.get("nummer"),
                    "date": row["dato"][:10],
                    "vedtaget": vote_row.get("vedtaget"),
                    "konklusion": vote_row.get("konklusion"),
                    "kommentar": vote_row.get("kommentar"),
                    "type_id": vote_type_id,
                    "type": afstemningstype_lookup.get(vote_type_id, {}).get("type"),
                    "sagstrin_id": int(row["id"]),
                    "sagstrin_title": row.get("titel"),
                    "sagstrin_type": sag_type.get("type"),
                    "sagstrin_status": sag_status.get("status"),
                    "sag_id": sag_id,
                    "sag_title": sag.get("titel"),
                    "sag_short_title": sag.get("titelkort"),
                    "sag_resume": sag.get("resume") or None,
                    "sag_number": sag.get("nummer"),
                    "sag_type_id": sag.get("typeid"),
                    "source_documents": sag_documents[:3],
                }
            )

    votes.sort(key=lambda item: (item["date"], item["afstemning_id"]), reverse=True)
    return votes


def build_case_timelines(
    *,
    sagstrin_rows: list[dict[str, Any]],
    case_document_links_by_sag: dict[int, list[dict[str, Any]]],
    stage_document_links_by_sagstrin: dict[int, list[dict[str, Any]]],
    sag_rows_by_id: dict[int, dict[str, Any]] | None = None,
    related_cases_by_sag: dict[int, list[dict[str, Any]]] | None = None,
    sag_emneord_by_sag: dict[int, list[dict[str, Any]]] | None = None,
    document_emneord_by_document_id: dict[int, list[dict[str, Any]]] | None = None,
    sag_actor_roles_by_sag: dict[int, list[dict[str, Any]]] | None = None,
    sag_type_lookup: dict[int, str] | None = None,
    sag_status_lookup: dict[int, str] | None = None,
    sag_category_lookup: dict[int, str] | None = None,
    meeting_context_by_sagstrin: dict[int, list[dict[str, Any]]] | None = None,
) -> list[dict[str, Any]]:
    sag_rows_by_id = sag_rows_by_id or {}
    related_cases_by_sag = related_cases_by_sag or {}
    sag_emneord_by_sag = sag_emneord_by_sag or {}
    document_emneord_by_document_id = document_emneord_by_document_id or {}
    sag_actor_roles_by_sag = sag_actor_roles_by_sag or {}
    sag_type_lookup = sag_type_lookup or {}
    sag_status_lookup = sag_status_lookup or {}
    sag_category_lookup = sag_category_lookup or {}
    meeting_context_by_sagstrin = meeting_context_by_sagstrin or {}

    rows_by_sag: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in sagstrin_rows:
        rows_by_sag[int(row["sagid"])].append(row)

    timelines: list[dict[str, Any]] = []
    for sag_id, rows in rows_by_sag.items():
        rows.sort(key=lambda item: (item.get("dato") or "", int(item["id"])))
        sag = sag_rows_by_id.get(sag_id) or (rows[-1].get("Sag") or rows[0].get("Sag") or {})

        steps: list[dict[str, Any]] = []
        for row in rows:
            sagstrin_id = int(row["id"])
            vote_ids = sorted(
                {
                    int(vote_row["id"])
                    for vote_row in (row.get("Afstemning") or [])
                    if vote_row.get("id") is not None
                }
            )
            steps.append(
                {
                    "sagstrin_id": sagstrin_id,
                    "date": (row.get("dato") or "")[:10] or None,
                    "title": row.get("titel"),
                    "type": (row.get("Sagstrinstype") or {}).get("type"),
                    "status": (row.get("Sagstrinsstatus") or {}).get("status"),
                    "vote_ids": vote_ids,
                    "documents": stage_document_links_by_sagstrin.get(sagstrin_id, [])[:5],
                    "agenda_items": meeting_context_by_sagstrin.get(sagstrin_id, [])[:5],
                }
            )

        case_documents = case_document_links_by_sag.get(sag_id, [])[:12]
        document_emneord_map: dict[int, dict[str, Any]] = {}
        for document in case_documents:
            document_id = int(document.get("document_id") or 0)
            if document_id <= 0:
                continue
            for emneord in document_emneord_by_document_id.get(document_id, []):
                document_emneord_map[int(emneord["id"])] = emneord
        for step in steps:
            for document in step.get("documents") or []:
                document_id = int(document.get("document_id") or 0)
                if document_id <= 0:
                    continue
                for emneord in document_emneord_by_document_id.get(document_id, []):
                    document_emneord_map[int(emneord["id"])] = emneord

        document_emneord = sorted(
            document_emneord_map.values(),
            key=lambda item: ((item.get("type") or ""), (item.get("emneord") or "")),
        )
        sag_emneord = list(sag_emneord_by_sag.get(sag_id, []))
        samlet_emneord_map: dict[int, dict[str, Any]] = {
            int(item["id"]): item
            for item in sag_emneord
        }
        for item in document_emneord:
            samlet_emneord_map[int(item["id"])] = item
        samlet_emneord = sorted(
            samlet_emneord_map.values(),
            key=lambda item: ((item.get("type") or ""), (item.get("emneord") or "")),
        )

        sag_type_id = int(sag.get("typeid") or 0)
        sag_status_id = int(sag.get("statusid") or 0)
        sag_category_id = int(sag.get("kategoriid") or 0)

        timelines.append(
            {
                "sag_id": sag_id,
                "sag_number": sag.get("nummer"),
                "sag_title": sag.get("titel"),
                "sag_short_title": sag.get("titelkort"),
                "sag_type_id": sag_type_id or None,
                "sag_type": sag_type_lookup.get(sag_type_id),
                "sag_status_id": sag_status_id or None,
                "sag_status": sag_status_lookup.get(sag_status_id),
                "sag_category_id": sag_category_id or None,
                "sag_category": sag_category_lookup.get(sag_category_id),
                "fremsatundersagid": sag.get("fremsatundersagid"),
                "deltundersagid": sag.get("deltundersagid"),
                "actors": sag_actor_roles_by_sag.get(sag_id, []),
                "law_followup": {
                    "law_number": sag.get("lovnummer"),
                    "law_number_date": (sag.get("lovnummerdato") or "")[:10] or None,
                    "decision_date": (sag.get("afgørelsesdato") or "")[:10] or None,
                    "decision_result_code": sag.get("afgørelsesresultatkode"),
                    "decision_text": sag.get("afgørelse"),
                    "retsinformation_url": sag.get("retsinformationsurl"),
                },
                "steps": steps,
                "documents": case_documents,
                "related_cases": related_cases_by_sag.get(sag_id, []),
                "emneord": {
                    "sag": sag_emneord,
                    "dokumenter": document_emneord,
                    "samlet": samlet_emneord,
                },
            }
        )

    timelines.sort(key=lambda item: (item.get("sag_number") or "", item["sag_id"]))
    return timelines


def vote_group_key(vote_type_id: int) -> str | None:
    if vote_type_id == 1:
        return "for"
    if vote_type_id == 2:
        return "imod"
    if vote_type_id == 3:
        return "fravaer"
    if vote_type_id == 4:
        return "hverken"
    return None


def parse_counts_from_konklusion(konklusion: str | None) -> dict[str, int] | None:
    if not konklusion:
        return None

    text = " ".join(str(konklusion).replace("\r", " ").replace("\n", " ").split())
    if not text:
        return None

    patterns = {
        "for": re.compile(r"\bfor stemte\s+(\d+)", flags=re.IGNORECASE),
        "imod": re.compile(r"\bimod stemte\s+(\d+)", flags=re.IGNORECASE),
        "hverken": re.compile(r"\bhverken for eller imod stemte\s+(\d+)", flags=re.IGNORECASE),
        "fravaer": re.compile(r"\bfrav(?:æ|ae)r(?:ende)?(?:\s+var)?\s+(\d+)", flags=re.IGNORECASE),
    }

    parsed = {"for": 0, "imod": 0, "hverken": 0, "fravaer": 0}
    matched_any = False
    for key, pattern in patterns.items():
        match = pattern.search(text)
        if not match:
            continue
        parsed[key] = int(match.group(1))
        matched_any = True

    return parsed if matched_any else None


def derive_profiles(
    *,
    people: list[dict[str, Any]],
    parties: list[dict[str, Any]],
    committees: list[dict[str, Any]],
    actor_relations: list[dict[str, Any]],
    votes: list[dict[str, Any]],
    stems: list[dict[str, Any]],
    stemmetyper: dict[int, dict[str, Any]],
    recent_vote_limit: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    actors_by_id: dict[int, dict[str, Any]] = {}
    for row in people + parties + committees:
        actors_by_id[int(row["id"])] = row

    person_ids = {int(person["id"]) for person in people}
    party_memberships, committee_memberships = build_memberships(actor_relations, actors_by_id, person_ids)
    vote_context_by_id = {int(vote["afstemning_id"]): vote for vote in votes}

    member_vote_counts: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    member_recent_votes: dict[int, list[dict[str, Any]]] = defaultdict(list)
    latest_vote_date_by_person: dict[int, date] = {}

    membership_cache: dict[tuple[int, str], dict[str, Any] | None] = {}
    committee_cache: dict[tuple[int, str], list[dict[str, Any]]] = {}
    loyalty_totals: dict[int, int] = defaultdict(int)
    loyalty_matches: dict[int, int] = defaultdict(int)

    stems_by_vote: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for stem in stems:
        vote_id = int(stem["afstemningid"])
        if vote_id in vote_context_by_id:
            stems_by_vote[vote_id].append(stem)

    def person_id_from_stem(stem: dict[str, Any]) -> int:
        for key in ("aktørid", "aktør_id", "aktoerid", "aktoer_id", "aktÃ¸rid", "aktÃƒÂ¸rid"):
            raw_value = stem.get(key)
            if raw_value is not None:
                return int(raw_value)
        raise KeyError("Missing actor id in stem row")

    def party_for_person_on(person_id: int, when_iso: str) -> dict[str, Any] | None:
        cache_key = (person_id, when_iso)
        if cache_key in membership_cache:
            return membership_cache[cache_key]
        memberships = party_memberships.get(person_id, [])
        membership = choose_latest_active(memberships, date.fromisoformat(when_iso))
        membership_cache[cache_key] = membership
        return membership

    def committees_for_person_on(person_id: int, when_iso: str) -> list[dict[str, Any]]:
        cache_key = (person_id, when_iso)
        if cache_key in committee_cache:
            return committee_cache[cache_key]
        on_date = date.fromisoformat(when_iso)
        memberships = [
            membership
            for membership in committee_memberships.get(person_id, [])
            if membership_active_on(membership, on_date)
        ]
        memberships.sort(key=membership_sort_key, reverse=True)
        committee_cache[cache_key] = memberships
        return memberships

    summarized_votes: list[dict[str, Any]] = []
    for vote in votes:
        vote_id = int(vote["afstemning_id"])
        vote_date_iso = vote["date"]
        vote_stems = stems_by_vote.get(vote_id, [])
        party_vote_buckets: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))

        for stem in vote_stems:
            person_id = person_id_from_stem(stem)
            if person_id not in person_ids:
                continue

            vote_type_id = int(stem["typeid"])
            member_vote_counts[person_id]["total"] += 1
            member_vote_counts[person_id][str(vote_type_id)] += 1

            latest_vote_date_by_person[person_id] = max(
                latest_vote_date_by_person.get(person_id, date.min),
                date.fromisoformat(vote_date_iso),
            )

            if vote_type_id in {1, 2, 4}:
                party_membership = party_for_person_on(person_id, vote_date_iso)
                if party_membership:
                    party_key = str(party_membership["actor"]["id"])
                    party_vote_buckets[party_key][vote_type_id] += 1

            member_recent_votes[person_id].append(
                {
                    "afstemning_id": vote_id,
                    "date": vote_date_iso,
                    "vote_type_id": vote_type_id,
                    "vote_type": stemmetyper.get(vote_type_id, {}).get("type"),
                    "sag_number": vote.get("sag_number"),
                    "sag_title": vote.get("sag_short_title") or vote.get("sag_title"),
                    "vedtaget": vote.get("vedtaget"),
                }
            )

        majority_by_party: dict[str, int] = {}
        party_split_count = 0
        for party_key, counts in party_vote_buckets.items():
            sorted_counts = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
            if len(sorted_counts) > 1 and sorted_counts[0][1] == sorted_counts[1][1]:
                party_split_count += 1
                continue
            majority_by_party[party_key] = sorted_counts[0][0]
            if len(sorted_counts) > 1:
                party_split_count += 1

        for stem in vote_stems:
            person_id = person_id_from_stem(stem)
            if person_id not in person_ids:
                continue

            vote_type_id = int(stem["typeid"])
            if vote_type_id not in {1, 2, 4}:
                continue

            party_membership = party_for_person_on(person_id, vote_date_iso)
            if not party_membership:
                continue

            majority_vote_type = majority_by_party.get(str(party_membership["actor"]["id"]))
            if majority_vote_type is None:
                continue

            loyalty_totals[person_id] += 1
            if majority_vote_type == vote_type_id:
                loyalty_matches[person_id] += 1

        counts: dict[int, int] = defaultdict(int)
        vote_groups: dict[str, list[int]] = {
            "for": [],
            "imod": [],
            "fravaer": [],
            "hverken": [],
        }
        vote_groups_by_party: dict[str, dict[str, list[int]]] = defaultdict(
            lambda: {
                "for": [],
                "imod": [],
                "fravaer": [],
                "hverken": [],
            }
        )
        for stem in vote_stems:
            person_id = person_id_from_stem(stem)
            if person_id not in person_ids:
                continue

            vote_type_id = int(stem["typeid"])
            counts[vote_type_id] += 1
            group_key = vote_group_key(vote_type_id)
            if group_key:
                vote_groups[group_key].append(person_id)
                party_membership = party_for_person_on(person_id, vote_date_iso)
                party_actor = party_membership["actor"] if party_membership else None
                party_key = (
                    party_actor.get("gruppenavnkort")
                    or party_actor.get("navn")
                    or "Uden parti"
                ) if party_actor else "Uden parti"
                vote_groups_by_party[party_key][group_key].append(person_id)

        counts_source = "stemme"
        if counts.get(1, 0) == 0 and counts.get(2, 0) == 0:
            parsed_counts = parse_counts_from_konklusion(vote.get("konklusion"))
            if parsed_counts and (
                parsed_counts["for"] > 0
                or parsed_counts["imod"] > 0
                or parsed_counts["hverken"] > 0
                or parsed_counts["fravaer"] > 0
            ):
                counts[1] = parsed_counts["for"]
                counts[2] = parsed_counts["imod"]
                counts[3] = parsed_counts["fravaer"]
                counts[4] = parsed_counts["hverken"]
                counts_source = "konklusion"

        summarized_votes.append(
            {
                **vote,
                "counts": {
                    "for": counts.get(1, 0),
                    "imod": counts.get(2, 0),
                    "fravaer": counts.get(3, 0),
                    "hverken": counts.get(4, 0),
                },
                "vote_groups": vote_groups,
                "vote_groups_by_party": vote_groups_by_party,
                "party_split_count": party_split_count,
                "margin": abs(counts.get(1, 0) - counts.get(2, 0)),
                "counts_source": counts_source,
            }
        )

    now = datetime.now(timezone.utc).date()
    current_party_member_ids: dict[int, set[int]] = defaultdict(set)
    current_committee_member_ids: dict[int, set[int]] = defaultdict(set)

    for person in people:
        person_id = int(person["id"])
        current_party = choose_latest_active(party_memberships.get(person_id, []), now)
        current_committees = committees_for_person_on(person_id, now.isoformat())

        if current_party:
            current_party_member_ids[int(current_party["actor"]["id"])].add(person_id)
        for committee_membership in current_committees:
            current_committee_member_ids[int(committee_membership["actor"]["id"])].add(person_id)

    included_person_ids = {
        person_id
        for person_id in person_ids
        if member_vote_counts.get(person_id)
        or any(person_id in member_ids for member_ids in current_party_member_ids.values())
        or any(person_id in member_ids for member_ids in current_committee_member_ids.values())
    }

    profiles: list[dict[str, Any]] = []
    for person in people:
        person_id = int(person["id"])
        if person_id not in included_person_ids:
            continue

        bio_fields = build_biography_fields(person)
        current_party = choose_latest_active(party_memberships.get(person_id, []), now)
        party_history = build_party_history(party_memberships.get(person_id, []), on_date=now)
        current_committees = committees_for_person_on(person_id, now.isoformat())
        latest_vote_date = latest_vote_date_by_person.get(person_id)
        last_vote_party = (
            party_for_person_on(person_id, latest_vote_date.isoformat()) if latest_vote_date else None
        )
        display_party = current_party or last_vote_party
        party_actor = display_party["actor"] if display_party else None
        constituency_text = bio_fields.get("current_constituency")

        recent_votes = member_recent_votes.get(person_id, [])
        recent_votes.sort(key=lambda item: (item["date"], item["afstemning_id"]), reverse=True)

        counts = member_vote_counts.get(person_id, {})
        votes_for = counts.get("1", 0)
        votes_against = counts.get("2", 0)
        votes_absent = counts.get("3", 0)
        votes_neither = counts.get("4", 0)
        total_votes = counts.get("total", 0)
        member_since_date = bio_fields.get("function_start_date") or parse_iso_date(person.get("startdato"))
        seniority_label, seniority_years, seniority_months = format_seniority_label(member_since_date, now)

        profiles.append(
            {
                "id": person_id,
                "name": person.get("navn"),
                "first_name": person.get("fornavn"),
                "last_name": person.get("efternavn"),
                "party": party_actor.get("navn") if party_actor else None,
                "party_short": (
                    party_actor.get("gruppenavnkort")
                    if party_actor and party_actor.get("gruppenavnkort")
                    else bio_fields.get("party_short_from_bio")
                ),
                "current_party": current_party["actor"]["navn"] if current_party else None,
                "current_party_short": (
                    current_party["actor"].get("gruppenavnkort") if current_party else None
                ),
                "committees": [
                    {
                        "id": int(membership["actor"]["id"]),
                        "name": membership["actor"].get("navn"),
                        "short_name": membership["actor"].get("gruppenavnkort"),
                    }
                    for membership in current_committees
                ],
                "role": bio_fields.get("profession") or bio_fields.get("title"),
                "constituency": constituency_text,
                "storkreds": extract_constituency_label(constituency_text),
                "constituency_history": bio_fields.get("constituency_history", []),
                "party_history": party_history,
                "educations": bio_fields.get("educations", []),
                "occupations": bio_fields.get("occupations", []),
                "email": bio_fields.get("email"),
                "phone": bio_fields.get("phone"),
                "website_url": bio_fields.get("website_url"),
                "address": bio_fields.get("address"),
                "member_url": bio_fields.get("member_url"),
                "photo_url": bio_fields.get("photo_url"),
                "photo_source_url": None,
                "photo_source_name": None,
                "photo_photographer": None,
                "photo_credit_text": None,
                "member_since_date": member_since_date.isoformat() if member_since_date else None,
                "member_since_year": member_since_date.year if member_since_date else None,
                "seniority_label": seniority_label,
                "seniority_years": seniority_years,
                "seniority_months": seniority_months,
                "seniority_tag": seniority_tag_key(member_since_date, now),
                "votes_total": total_votes,
                "votes_for": votes_for,
                "votes_against": votes_against,
                "votes_neither": votes_neither,
                "votes_absent": votes_absent,
                "attendance_pct": round_pct(total_votes - votes_absent, total_votes),
                "party_loyalty_pct": round_pct(
                    loyalty_matches.get(person_id, 0),
                    loyalty_totals.get(person_id, 0),
                ),
                "party_loyalty_matches": loyalty_matches.get(person_id, 0),
                "party_loyalty_comparisons": loyalty_totals.get(person_id, 0),
                "recent_votes": recent_votes[:recent_vote_limit],
            }
        )

    profiles.sort(
        key=lambda item: (
            item["party_short"] or "ZZZ",
            item["last_name"] or "",
            item["first_name"] or "",
        )
    )

    party_summaries: list[dict[str, Any]] = []
    for party in parties:
        party_id = int(party["id"])
        member_ids = sorted(current_party_member_ids.get(party_id, set()))
        if not member_ids:
            continue
        party_summaries.append(
            {
                "id": party_id,
                "name": party.get("navn"),
                "short_name": party.get("gruppenavnkort"),
                "member_count": len(member_ids),
                "member_ids": member_ids,
            }
        )
    party_summaries.sort(key=lambda item: (item["short_name"] or "", item["name"] or ""))

    committee_summaries: list[dict[str, Any]] = []
    for committee in committees:
        committee_id = int(committee["id"])
        member_ids = sorted(current_committee_member_ids.get(committee_id, set()))
        if not member_ids:
            continue
        committee_summaries.append(
            {
                "id": committee_id,
                "name": committee.get("navn"),
                "short_name": committee.get("gruppenavnkort"),
                "member_count": len(member_ids),
                "member_ids": member_ids,
            }
        )
    committee_summaries.sort(key=lambda item: item["name"] or "")

    metadata = {
        "profile_count": len(profiles),
        "party_count": len(party_summaries),
        "committee_count": len(committee_summaries),
        "vote_count": len(summarized_votes),
        "individual_vote_count": len(stems),
    }

    summarized_votes.sort(key=lambda item: (item["date"], item["afstemning_id"]), reverse=True)
    return profiles, party_summaries, committee_summaries, summarized_votes, metadata


def _wikidata_search(name: str, language: str) -> list[dict[str, Any]]:
    cache_key = (language, name)
    if cache_key in WIKIDATA_SEARCH_CACHE:
        return WIKIDATA_SEARCH_CACHE[cache_key]

    search_url = (
        "https://www.wikidata.org/w/api.php"
        "?action=wbsearchentities"
        f"&search={quote(name)}"
        f"&language={quote(language)}"
        "&type=item&format=json&limit=8"
    )
    try:
        req = Request(search_url, headers=WIKIDATA_HEADERS)
        with urlopen(req, timeout=15) as resp:
            data = json.load(resp)
    except Exception:
        WIKIDATA_SEARCH_CACHE[cache_key] = []
        return []

    results = data.get("search", [])
    WIKIDATA_SEARCH_CACHE[cache_key] = results
    return results


def _wikidata_candidate_name_score(query: str, candidate: str) -> int:
    normalized_query = normalize_name_text(query)
    normalized_candidate = normalize_name_text(candidate)
    if not normalized_query or not normalized_candidate:
        return 0
    if normalized_query == normalized_candidate:
        return 140

    query_tokens = normalized_query.split()
    candidate_tokens = normalized_candidate.split()
    overlap = len(set(query_tokens) & set(candidate_tokens))
    score = overlap * 16

    if normalized_query in normalized_candidate:
        score += 28
    if normalized_candidate in normalized_query:
        score += 10
    if query_tokens and all(token in candidate_tokens for token in query_tokens):
        score += 35

    return score


def _wikidata_candidate_score(name: str, result: dict[str, Any]) -> int:
    score = _wikidata_candidate_name_score(name, result.get("label") or "")

    for alias in result.get("aliases", []):
        score = max(score, _wikidata_candidate_name_score(name, alias) + 18)

    match = result.get("match") or {}
    match_text = match.get("text") or ""
    if match_text:
        score = max(score, _wikidata_candidate_name_score(name, match_text) + 22)

    description = (result.get("description") or "").lower()
    if any(keyword in description for keyword in WIKIDATA_POSITIVE_DESC_KEYWORDS):
        score += 24
    if any(keyword in description for keyword in WIKIDATA_POSITIVE_NATIONALITY_KEYWORDS):
        score += 8
    if any(keyword in description for keyword in WIKIDATA_NEGATIVE_DESC_KEYWORDS):
        score -= 18

    if (match.get("type") or "") == "alias":
        score += 8
    return score


def _wikidata_entity(qid: str) -> dict[str, Any]:
    if qid in WIKIDATA_ENTITY_CACHE:
        return WIKIDATA_ENTITY_CACHE[qid]

    entity_url = f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
    try:
        req = Request(entity_url, headers=WIKIDATA_HEADERS)
        with urlopen(req, timeout=15) as resp:
            entity_data = json.load(resp)
    except Exception:
        WIKIDATA_ENTITY_CACHE[qid] = {}
        return {}

    entity = entity_data.get("entities", {}).get(qid, {})
    WIKIDATA_ENTITY_CACHE[qid] = entity
    return entity


def _wikidata_entity_has_political_signal(entity: dict[str, Any], fallback_description: str) -> bool:
    description_values = [
        value.get("value", "").lower()
        for value in entity.get("descriptions", {}).values()
        if isinstance(value, dict)
    ]
    descriptions = description_values + [fallback_description.lower()]
    if any(
        keyword in description
        for description in descriptions
        for keyword in WIKIDATA_POSITIVE_DESC_KEYWORDS
    ):
        return True

    position_ids = {
        claim.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("id")
        for claim in entity.get("claims", {}).get("P39", [])
    }
    occupation_ids = {
        claim.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("id")
        for claim in entity.get("claims", {}).get("P106", [])
    }
    return bool({"Q12311817", "Q82955"} & (position_ids | occupation_ids))


def _wikidata_photo_url(name: str) -> str | None:
    """Search Wikidata for a person by name and return their Wikimedia Commons image URL."""
    candidates: dict[str, dict[str, Any]] = {}
    for language in ("da", "en"):
        for result in _wikidata_search(name, language):
            qid = result.get("id")
            if not qid:
                continue
            score = _wikidata_candidate_score(name, result)
            previous = candidates.get(qid)
            if previous is None or score > previous["score"]:
                candidates[qid] = {"result": result, "score": score}

    ranked_candidates = sorted(
        candidates.values(),
        key=lambda item: item["score"],
        reverse=True,
    )
    if not ranked_candidates:
        return None

    for candidate in ranked_candidates[:4]:
        if candidate["score"] < 42:
            continue
        result = candidate["result"]
        entity = _wikidata_entity(result["id"])
        if not entity:
            continue
        if not _wikidata_entity_has_political_signal(entity, result.get("description") or ""):
            continue

        p18 = entity.get("claims", {}).get("P18", [])
        if not p18:
            continue

        image_value = p18[0].get("mainsnak", {}).get("datavalue", {}).get("value")
        if not image_value:
            continue

        fname = image_value.replace(" ", "_")
        if fname.lower().endswith((".svg", ".tif", ".tiff", ".pdf")):
            continue

        md5 = hashlib.md5(fname.encode("utf-8")).hexdigest()
        return f"https://upload.wikimedia.org/wikipedia/commons/{md5[0]}/{md5[:2]}/{quote(fname)}"

    return None


def _download_one_photo(
    person_id: int,
    name: str,
    photos_dir: Path,
) -> tuple[int, str | None]:
    # Return cached photo if it already exists (any common extension)
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        cached = photos_dir / f"{person_id}{ext}"
        if cached.exists():
            return person_id, f"photos/{person_id}{ext}"

    img_url = _wikidata_photo_url(name)
    if not img_url:
        return person_id, None

    # Determine extension from URL (default jpg)
    url_lower = img_url.split("?")[0].lower()
    ext = ".jpg"
    for candidate in (".png", ".gif", ".webp", ".jpeg"):
        if url_lower.endswith(candidate):
            ext = candidate
            break

    target = photos_dir / f"{person_id}{ext}"
    try:
        req = Request(img_url, headers=WIKIDATA_HEADERS)
        with urlopen(req, timeout=20) as resp:
            content_type = resp.headers.get("Content-Type", "")
            if not content_type.startswith("image/"):
                return person_id, None
            target.write_bytes(resp.read())
            return person_id, f"photos/{person_id}{ext}"
    except Exception:
        return person_id, None


def download_all_photos(
    profiles: list[dict[str, Any]],
    photos_dir: Path,
    verbose: bool,
    max_workers: int,
) -> None:
    ensure_dir(photos_dir)
    to_download = [(p["id"], p["name"]) for p in profiles if p.get("name")]
    if not to_download:
        return

    log(verbose, f"looking up {len(to_download)} photos via Wikidata with {max_workers} workers")

    results: dict[int, str | None] = {}
    with ThreadPoolExecutor(max_workers=max(1, max_workers)) as executor:
        futures = {
            executor.submit(_download_one_photo, pid, name, photos_dir): pid
            for pid, name in to_download
        }
        for future in as_completed(futures):
            pid, local_path = future.result()
            results[pid] = local_path
            if verbose and len(results) % 20 == 0:
                ok = sum(1 for v in results.values() if v)
                log(True, f"photos: {len(results)}/{len(to_download)} done, {ok} ok")

    ok_count = sum(1 for v in results.values() if v)
    log(verbose, f"photos: {ok_count}/{len(to_download)} fetched from Wikidata")

    for profile in profiles:
        pid = profile["id"]
        if pid in results:
            profile["photo_url"] = results[pid]


def split_vote_payloads(votes: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    overview_votes: list[dict[str, Any]] = []
    vote_details: list[dict[str, Any]] = []

    def dedupe_ids(ids: list[Any]) -> list[int]:
        seen: set[int] = set()
        unique: list[int] = []
        for raw in ids:
            value = int(raw or 0)
            if value <= 0 or value in seen:
                continue
            seen.add(value)
            unique.append(value)
        return unique

    def dedupe_vote_groups(groups: dict[str, Any]) -> dict[str, list[int]]:
        result: dict[str, list[int]] = {}
        for key in ("for", "imod", "fravaer", "hverken"):
            values = groups.get(key)
            result[key] = dedupe_ids(values if isinstance(values, list) else [])
        return result

    def dedupe_vote_groups_by_party(groups_by_party: dict[str, Any]) -> dict[str, dict[str, list[int]]]:
        result: dict[str, dict[str, list[int]]] = {}
        for party_key, party_groups in groups_by_party.items():
            if not isinstance(party_groups, dict):
                continue
            result[str(party_key)] = {
                key: dedupe_ids(values if isinstance(values, list) else [])
                for key, values in party_groups.items()
            }
        return result

    for vote in votes:
        vote_id = int(vote.get("afstemning_id") or 0)
        overview = dict(vote)
        overview.pop("vote_groups", None)
        overview.pop("vote_groups_by_party", None)
        overview.pop("sag_resume", None)
        overview.pop("konklusion", None)
        overview.pop("kommentar", None)
        overview_votes.append(overview)

        vote_groups = dedupe_vote_groups(vote.get("vote_groups") or {})
        vote_groups_by_party = dedupe_vote_groups_by_party(vote.get("vote_groups_by_party") or {})
        vote_details.append(
            {
                "afstemning_id": vote_id,
                "vote_groups": vote_groups,
                "vote_groups_by_party": vote_groups_by_party,
                "sag_resume": vote.get("sag_resume"),
                "konklusion": vote.get("konklusion"),
                "kommentar": vote.get("kommentar"),
            }
        )

    return overview_votes, vote_details


def build_vote_meta_rows(vote_overview: list[dict[str, Any]]) -> list[dict[str, Any]]:
    meta_rows: list[dict[str, Any]] = []
    for vote in vote_overview:
        vote_id = int(vote.get("afstemning_id") or 0)
        if vote_id <= 0:
            continue
        meta_rows.append(
            {
                "afstemning_id": vote_id,
                "date": vote.get("date"),
                "sag_number": vote.get("sag_number"),
                "sag_title": vote.get("sag_short_title") or vote.get("sag_title"),
                "vedtaget": vote.get("vedtaget"),
            }
        )
    return meta_rows


def build_profile_vote_id_groups(
    votes: list[dict[str, Any]],
    *,
    profile_ids: set[int],
) -> dict[int, dict[str, list[int]]]:
    groups_by_person: dict[int, dict[str, list[int]]] = {
        int(profile_id): {
            "for": [],
            "imod": [],
            "fravaer": [],
            "hverken": [],
        }
        for profile_id in profile_ids
        if int(profile_id) > 0
    }

    for vote in votes:
        vote_id = int(vote.get("afstemning_id") or 0)
        if vote_id <= 0:
            continue
        vote_groups = vote.get("vote_groups") if isinstance(vote.get("vote_groups"), dict) else {}
        for group_key in ("for", "imod", "fravaer", "hverken"):
            person_ids = vote_groups.get(group_key)
            if not isinstance(person_ids, list):
                continue
            normalized_person_ids: set[int] = set()
            for raw in person_ids:
                try:
                    person_id = int(raw or 0)
                except (TypeError, ValueError):
                    continue
                if person_id > 0:
                    normalized_person_ids.add(person_id)
            for person_id in normalized_person_ids:
                if person_id not in groups_by_person:
                    continue
                groups_by_person[person_id][group_key].append(vote_id)

    for person_id, grouped_votes in groups_by_person.items():
        for group_key in ("for", "imod", "fravaer", "hverken"):
            deduped_vote_ids: list[int] = []
            seen_vote_ids: set[int] = set()
            for vote_id in grouped_votes[group_key]:
                if vote_id in seen_vote_ids:
                    continue
                seen_vote_ids.add(vote_id)
                deduped_vote_ids.append(vote_id)
            grouped_votes[group_key] = deduped_vote_ids
        groups_by_person[person_id] = grouped_votes

    return groups_by_person


def shard_key_for_id(value: int, shard_count: int) -> str:
    safe_count = max(1, int(shard_count))
    return f"{int(value or 0) % safe_count:02d}"


def build_vote_detail_index_and_shards(
    vote_details: list[dict[str, Any]],
    *,
    shard_count: int = VOTE_DETAIL_SHARD_COUNT,
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    index_rows: list[dict[str, Any]] = []
    shard_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for row in vote_details:
        vote_id = int(row.get("afstemning_id") or 0)
        if vote_id <= 0:
            continue
        shard_key = shard_key_for_id(vote_id, shard_count)
        index_rows.append(
            {
                "afstemning_id": vote_id,
                "shard": shard_key,
            }
        )
        shard_rows[shard_key].append(row)

    for key in shard_rows:
        shard_rows[key].sort(key=lambda item: int(item.get("afstemning_id") or 0), reverse=True)
    index_rows.sort(key=lambda item: int(item.get("afstemning_id") or 0), reverse=True)
    return index_rows, dict(shard_rows)


def compact_relation_text(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").strip().lower())


def extract_case_prefix(sag_number: Any) -> str:
    match = re.match(r"^\s*([A-Za-z]+)", str(sag_number or ""))
    return match.group(1).upper() if match else ""


def summarize_timeline_emneord(emneord: Any) -> dict[str, Any]:
    source = emneord if isinstance(emneord, dict) else {}
    labels: set[str] = set()

    def collect(entries: Any) -> None:
        if not isinstance(entries, list):
            return
        for entry in entries:
            label = str((entry or {}).get("emneord") or "").strip()
            if not label:
                continue
            emneord_type = str((entry or {}).get("type") or "").strip()
            labels.add(f"{label} ({emneord_type})" if emneord_type else label)

    collect(source.get("sag"))
    collect(source.get("dokumenter"))
    collect(source.get("samlet"))

    sorted_labels = sorted(labels, key=lambda value: value.lower())
    return {
        "primary": sorted_labels[0] if sorted_labels else None,
        "labels": sorted_labels[:12],
        "count": len(sorted_labels),
    }


def build_timeline_index_and_shards(
    case_timelines: list[dict[str, Any]],
    *,
    shard_count: int = TIMELINE_SHARD_COUNT,
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    index_rows: list[dict[str, Any]] = []
    shard_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for timeline in case_timelines:
        sag_id = int(timeline.get("sag_id") or 0)
        if sag_id <= 0:
            continue

        shard_key = shard_key_for_id(sag_id, shard_count)
        related_cases = timeline.get("related_cases") if isinstance(timeline.get("related_cases"), list) else []
        related_case_prefixes = sorted(
            {
                prefix
                for prefix in (extract_case_prefix(case.get("sag_number")) for case in related_cases)
                if prefix
            }
        )

        fremsat_under = None
        for related_case in related_cases:
            relations = related_case.get("relations") if isinstance(related_case.get("relations"), list) else []
            if any(compact_relation_text(relation) == "fremsatunder" for relation in relations):
                fremsat_under = {
                    "sag_id": int(related_case.get("sag_id") or 0) or None,
                    "sag_number": related_case.get("sag_number"),
                    "sag_short_title": related_case.get("sag_short_title"),
                    "sag_title": related_case.get("sag_title"),
                }
                break

        index_rows.append(
            {
                "sag_id": sag_id,
                "shard": shard_key,
                "sag_type": timeline.get("sag_type"),
                "sag_status": timeline.get("sag_status"),
                "sag_category": timeline.get("sag_category"),
                "related_case_prefixes": related_case_prefixes,
                "fremsat_under": fremsat_under,
                "emneord": summarize_timeline_emneord(timeline.get("emneord")),
            }
        )
        shard_rows[shard_key].append(timeline)

    for key in shard_rows:
        shard_rows[key].sort(key=lambda item: int(item.get("sag_id") or 0))
    index_rows.sort(key=lambda item: int(item.get("sag_id") or 0))
    return index_rows, dict(shard_rows)


def main() -> None:
    args = parse_args()
    options = FetchOptions(
        delay=max(args.delay, 0),
        page_size=max(args.page_size, 1),
        verbose=args.verbose,
    )
    client = OdaClient(options)

    output_dir = Path(args.output_dir)
    raw_dir = Path(args.raw_dir)
    ensure_dir(output_dir)

    start_date = date.fromisoformat(args.start_date).isoformat()
    today_iso = datetime.now(timezone.utc).date().isoformat()

    if args.timelines_only:
        votes_path = output_dir / "afstemninger.json"
        if not votes_path.exists():
            raise RuntimeError(
                f"{votes_path} is missing; run full fetch once before --timelines-only"
            )
        existing_votes = json.loads(votes_path.read_text(encoding="utf-8"))
        sag_ids = sorted(
            {
                int(vote["sag_id"])
                for vote in existing_votes
                if vote.get("sag_id") is not None
            }
        )
        if not sag_ids:
            raise RuntimeError("No sag IDs found in existing afstemninger.json")

        log(options.verbose, f"timeline-only: fetching full sagstrin for {len(sag_ids)} sager")
        timeline_sagstrin_rows = fetch_sagstrin_for_sager(client, sag_ids=sag_ids)
        sag_rows = fetch_sager_by_ids(client, sag_ids=sag_ids)
        sag_rows_by_id = {int(row["id"]): row for row in sag_rows}
        sagstrin_ids = sorted({int(row["id"]) for row in timeline_sagstrin_rows})
        log(options.verbose, "timeline-only: fetching lookup tables for metadata")
        actor_types = client.fetch_collection("Akt%C3%B8rtype", label="aktortype")
        sag_actor_role_rows = client.fetch_collection("SagAkt%C3%B8rRolle", label="sag-aktor-rolle")
        sagstype_rows = client.fetch_collection("Sagstype", label="sagstype")
        sagsstatus_rows = client.fetch_collection("Sagsstatus", label="sagsstatus")
        sagskategori_rows = client.fetch_collection("Sagskategori", label="sagskategori")
        dokument_actor_role_rows = client.fetch_collection("DokumentAkt%C3%B8rRolle", label="dokument-aktor-rolle")
        dokument_type_rows = client.fetch_collection("Dokumenttype", label="dokumenttype")
        dokument_status_rows = client.fetch_collection("Dokumentstatus", label="dokumentstatus")
        dokumentkategori_rows = client.fetch_collection("Dokumentkategori", label="dokumentkategori")
        moedetype_rows = client.fetch_collection("M%C3%B8detype", label="moedetype")
        moedestatus_rows = client.fetch_collection("M%C3%B8destatus", label="moedestatus")

        log(options.verbose, f"timeline-only: fetching sambehandlinger for {len(sagstrin_ids)} sagstrin")
        sambehandling_rows = fetch_sambehandling_rows(client, sagstrin_ids=sagstrin_ids)
        first_stage_field = "førstesagstrinid"
        second_stage_field = "andetsagstrinid"
        stage_ids_from_sambehandling = {
            int(row.get(first_stage_field) or 0)
            for row in sambehandling_rows
        } | {
            int(row.get(second_stage_field) or 0)
            for row in sambehandling_rows
        }
        stage_ids_from_sambehandling = {item for item in stage_ids_from_sambehandling if item > 0}
        missing_relation_stage_ids = sorted(stage_ids_from_sambehandling - set(sagstrin_ids))
        relation_sagstrin_rows = list(timeline_sagstrin_rows)
        if missing_relation_stage_ids:
            log(
                options.verbose,
                f"timeline-only: fetching {len(missing_relation_stage_ids)} ekstra sagstrin til sambehandling",
            )
            relation_sagstrin_rows.extend(
                fetch_sagstrin_by_ids(client, sagstrin_ids=missing_relation_stage_ids)
            )
        relation_sagstrin_rows_by_id = {int(row["id"]): row for row in relation_sagstrin_rows}
        relation_sagstrin_rows = list(relation_sagstrin_rows_by_id.values())

        related_sag_ids: set[int] = set()
        for sag in sag_rows_by_id.values():
            fremsat_under_sag_id = int(sag.get("fremsatundersagid") or 0)
            delt_under_sag_id = int(sag.get("deltundersagid") or 0)
            if fremsat_under_sag_id > 0:
                related_sag_ids.add(fremsat_under_sag_id)
            if delt_under_sag_id > 0:
                related_sag_ids.add(delt_under_sag_id)

        relation_stage_to_sag = {
            int(row["id"]): int(row["sagid"])
            for row in relation_sagstrin_rows
            if row.get("id") is not None and row.get("sagid") is not None
        }
        for row in sambehandling_rows:
            first_stage_id = int(row.get(first_stage_field) or 0)
            second_stage_id = int(row.get(second_stage_field) or 0)
            first_sag_id = relation_stage_to_sag.get(first_stage_id)
            second_sag_id = relation_stage_to_sag.get(second_stage_id)
            if first_sag_id:
                related_sag_ids.add(first_sag_id)
            if second_sag_id:
                related_sag_ids.add(second_sag_id)

        extra_related_sag_ids = sorted(related_sag_ids - set(sag_rows_by_id))
        if extra_related_sag_ids:
            log(options.verbose, f"timeline-only: fetching {len(extra_related_sag_ids)} relaterede sager")
            extra_sag_rows = fetch_sager_by_ids(client, sag_ids=extra_related_sag_ids)
            sag_rows_by_id.update({int(row["id"]): row for row in extra_sag_rows})

        related_cases_by_sag = build_related_cases_by_sag(
            primary_sag_ids=sag_ids,
            sag_rows_by_id=sag_rows_by_id,
            sagstrin_rows=relation_sagstrin_rows,
            sambehandling_rows=sambehandling_rows,
        )
        log(options.verbose, f"timeline-only: fetching case actor roles for {len(sag_ids)} sager")
        sag_actor_rows = fetch_sag_actor_rows(client, sag_ids=sag_ids)
        sag_actor_ids = sorted(
            {
                int(
                    row_value(
                        row,
                        "aktørid",
                        "akt\u00f8rid",
                        "aktør_id",
                        "akt\u00f8r_id",
                        "aktoerid",
                        "aktoer_id",
                    )
                    or 0
                )
                for row in sag_actor_rows
            }
            - {0}
        )
        sag_actor_rows_by_id = {int(row["id"]): row for row in fetch_actors_by_ids(client, actor_ids=sag_actor_ids)}
        actor_type_lookup = build_id_label_lookup(actor_types, "type")
        sag_actor_role_lookup = build_id_label_lookup(sag_actor_role_rows, "rolle")
        sag_actor_roles_by_sag = build_sag_actor_roles_by_sag(
            sag_actor_rows=sag_actor_rows,
            sag_actor_role_lookup=sag_actor_role_lookup,
            actors_by_id=sag_actor_rows_by_id,
            actor_type_lookup=actor_type_lookup,
        )
        sag_type_lookup = build_id_label_lookup(sagstype_rows, "type")
        sag_status_lookup = build_id_label_lookup(sagsstatus_rows, "status")
        sag_category_lookup = build_id_label_lookup(sagskategori_rows, "kategori")

        log(options.verbose, f"timeline-only: fetching case documents for {len(sag_ids)} sager")
        sag_document_rows = fetch_sag_documents(client, sag_ids=sag_ids)

        log(options.verbose, f"timeline-only: fetching stage documents for {len(sagstrin_ids)} sagstrin")
        sagstrin_document_rows = fetch_sagstrin_documents(client, sagstrin_ids=sagstrin_ids)
        document_ids = collect_document_ids(
            sag_document_rows=sag_document_rows,
            sagstrin_document_rows=sagstrin_document_rows,
        )
        log(options.verbose, f"timeline-only: fetching document provenance for {len(document_ids)} dokumenter")
        document_actor_rows = fetch_dokument_actor_rows(client, document_ids=document_ids)
        document_actor_ids = collect_document_actor_ids(document_actor_rows)
        document_actor_rows_by_id = {
            int(row["id"]): row
            for row in fetch_actors_by_ids(client, actor_ids=document_actor_ids)
        }
        document_actor_role_lookup = build_id_label_lookup(dokument_actor_role_rows, "rolle")
        document_type_lookup = build_id_label_lookup(dokument_type_rows, "type")
        document_status_lookup = build_id_label_lookup(dokument_status_rows, "status")
        document_category_lookup = build_id_label_lookup(dokumentkategori_rows, "kategori")
        document_rows_by_id = collect_document_records(
            sag_document_rows=sag_document_rows,
            sagstrin_document_rows=sagstrin_document_rows,
        )
        document_provenance_by_document_id = build_document_provenance_map(
            document_actor_rows=document_actor_rows,
            document_actor_role_lookup=document_actor_role_lookup,
            actors_by_id=document_actor_rows_by_id,
            actor_type_lookup=actor_type_lookup,
            document_rows_by_id=document_rows_by_id,
            document_type_lookup=document_type_lookup,
            document_status_lookup=document_status_lookup,
            document_category_lookup=document_category_lookup,
        )

        log(options.verbose, f"timeline-only: fetching omtryk for {len(document_ids)} dokumenter")
        omtryk_rows = fetch_omtryk_rows(client, document_ids=document_ids)
        omtryk_by_document_id = build_omtryk_map(omtryk_rows)

        case_document_links_by_sag = make_document_links(
            sag_document_rows,
            omtryk_by_document_id=omtryk_by_document_id,
        )
        document_links_by_sagstrin = make_sagstrin_document_links(
            sagstrin_document_rows,
            omtryk_by_document_id=omtryk_by_document_id,
        )
        case_document_links_by_sag = enrich_document_links_with_provenance(
            case_document_links_by_sag,
            document_provenance_by_document_id,
        )
        document_links_by_sagstrin = enrich_document_links_with_provenance(
            document_links_by_sagstrin,
            document_provenance_by_document_id,
        )
        stage_document_links_by_sag = make_case_document_links_from_sagstrin(
            sagstrin_rows=timeline_sagstrin_rows,
            stage_document_links_by_sagstrin=document_links_by_sagstrin,
        )
        log(options.verbose, f"timeline-only: fetching meeting context for {len(sagstrin_ids)} sagstrin")
        dagsordenspunkt_rows = fetch_dagsordenspunkt_rows(client, sagstrin_ids=sagstrin_ids)
        moede_ids = sorted(
            {
                int(
                    row_value(
                        row,
                        "mødeid",
                        "m\u00f8deid",
                        "moedeid",
                    )
                    or 0
                )
                for row in dagsordenspunkt_rows
            }
            - {0}
        )
        moede_rows_by_id = {int(row["id"]): row for row in fetch_moeder_by_ids(client, moede_ids=moede_ids)}
        moede_type_lookup = build_id_label_lookup(moedetype_rows, "type")
        moede_status_lookup = build_id_label_lookup(moedestatus_rows, "status")
        meeting_context_by_sagstrin = build_meeting_context_by_sagstrin(
            dagsordenspunkt_rows=dagsordenspunkt_rows,
            moede_rows_by_id=moede_rows_by_id,
            moede_type_lookup=moede_type_lookup,
            moede_status_lookup=moede_status_lookup,
        )

        log(options.verbose, f"timeline-only: fetching emneord for {len(sag_ids)} sager")
        emneordsag_rows = fetch_emneordsag_rows(client, sag_ids=sag_ids)
        emneorddokument_rows = fetch_emneorddokument_rows(client, document_ids=document_ids)
        emneord_ids = sorted(
            {
                int(row["emneordid"])
                for row in emneordsag_rows + emneorddokument_rows
                if row.get("emneordid") is not None
            }
        )
        emneord_rows = fetch_emneord_rows(client, emneord_ids=emneord_ids)
        emneordstype_rows = client.fetch_collection("Emneordstype", label="emneordstype")
        emneord_lookup = build_emneord_lookup(emneord_rows, emneordstype_rows)
        sag_emneord_by_sag = build_sag_emneord_map(emneordsag_rows, emneord_lookup)
        document_emneord_by_document_id = build_document_emneord_map(emneorddokument_rows, emneord_lookup)

        document_links_by_sag: dict[int, list[dict[str, Any]]] = {}
        for sag_id in sorted(set(case_document_links_by_sag) | set(stage_document_links_by_sag)):
            merged_links = (case_document_links_by_sag.get(sag_id) or []) + (stage_document_links_by_sag.get(sag_id) or [])
            seen: set[str] = set()
            unique_links: list[dict[str, Any]] = []
            for link in merged_links:
                url = str(link.get("url") or "")
                if not url or url in seen:
                    continue
                seen.add(url)
                unique_links.append(link)
            document_links_by_sag[sag_id] = unique_links

        case_timelines = build_case_timelines(
            sagstrin_rows=timeline_sagstrin_rows,
            case_document_links_by_sag=document_links_by_sag,
            stage_document_links_by_sagstrin=document_links_by_sagstrin,
            sag_rows_by_id=sag_rows_by_id,
            related_cases_by_sag=related_cases_by_sag,
            sag_emneord_by_sag=sag_emneord_by_sag,
            document_emneord_by_document_id=document_emneord_by_document_id,
            sag_actor_roles_by_sag=sag_actor_roles_by_sag,
            sag_type_lookup=sag_type_lookup,
            sag_status_lookup=sag_status_lookup,
            sag_category_lookup=sag_category_lookup,
            meeting_context_by_sagstrin=meeting_context_by_sagstrin,
        )
        meeting_overview = build_meeting_overview(case_timelines)
        meeting_overview["generated_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        timeline_index, timeline_shards = build_timeline_index_and_shards(case_timelines)
        write_json(output_dir / "moeder.json", meeting_overview)
        write_json(output_dir / "sag_tidslinjer.json", case_timelines)
        write_json_compact(output_dir / "sag_tidslinjer_index.json", timeline_index)
        write_json_shards(output_dir / "sag_tidslinjer_shards", timeline_shards)
        log(options.verbose, f"timeline-only: wrote {len(case_timelines)} timelines")
        return

    log(options.verbose, "fetching lookup tables")
    actor_types = client.fetch_collection("Akt%C3%B8rtype", label="aktortype")
    stemmetyper = client.fetch_collection("Stemmetype", label="stemmetype")
    afstemningstyper = client.fetch_collection("Afstemningstype", label="afstemningstype")

    log(options.verbose, "determining vote window")
    vote_window, sagstrin_rows = determine_vote_window(client, start_date=start_date, today_iso=today_iso)

    allowed_vote_ids = {
        int(vote_row["id"])
        for sagstrin_row in sagstrin_rows
        for vote_row in (sagstrin_row.get("Afstemning") or [])
    }
    log(options.verbose, "extracting vote records from expanded vote pages")
    stems = extract_vote_records(
        client,
        sagstrin_rows=sagstrin_rows,
        max_workers=max(args.vote_workers, 1),
    )

    log(options.verbose, "fetching party and committee actors")
    active_actor_filter = (
        f"(typeid eq 4 or typeid eq 3) and "
        f"(slutdato eq null or slutdato ge datetime'{start_date}T00:00:00')"
    )
    org_actors = client.fetch_collection(
        "Akt%C3%B8r",
        params={"$filter": active_actor_filter},
        label="org-actors",
    )
    parties = [row for row in org_actors if int(row["typeid"]) == 4]
    committees = [row for row in org_actors if int(row["typeid"]) == 3]

    log(options.verbose, "fetching relevant actor relations")
    source_actor_ids = sorted(int(row["id"]) for row in org_actors)
    actor_relations = fetch_actor_relations_for_sources(
        client,
        source_actor_ids=source_actor_ids,
        start_date=start_date,
    )
    person_ids = sorted(
        {
            int(row["aktørid"])
            for row in stems
        }
        | {
            int(row["tilaktørid"])
            for row in actor_relations
        }
    )
    people = fetch_people_by_ids(client, person_ids=person_ids)

    stemmetype_lookup = collect_lookup_map(stemmetyper)
    afstemningstype_lookup = collect_lookup_map(afstemningstyper)
    sag_ids = sorted({int(row["sagid"]) for row in sagstrin_rows})
    log(options.verbose, f"fetching full timelines for {len(sag_ids)} sager")
    timeline_sagstrin_rows = fetch_sagstrin_for_sager(client, sag_ids=sag_ids)
    if not timeline_sagstrin_rows:
        timeline_sagstrin_rows = list(sagstrin_rows)
    sag_rows = fetch_sager_by_ids(client, sag_ids=sag_ids)
    sag_rows_by_id = {int(row["id"]): row for row in sag_rows}
    sagstrin_ids = sorted({int(row["id"]) for row in timeline_sagstrin_rows})
    log(options.verbose, "fetching lookup tables for timeline metadata")
    sag_actor_role_rows = client.fetch_collection("SagAkt%C3%B8rRolle", label="sag-aktor-rolle")
    sagstype_rows = client.fetch_collection("Sagstype", label="sagstype")
    sagsstatus_rows = client.fetch_collection("Sagsstatus", label="sagsstatus")
    sagskategori_rows = client.fetch_collection("Sagskategori", label="sagskategori")
    dokument_actor_role_rows = client.fetch_collection("DokumentAkt%C3%B8rRolle", label="dokument-aktor-rolle")
    dokument_type_rows = client.fetch_collection("Dokumenttype", label="dokumenttype")
    dokument_status_rows = client.fetch_collection("Dokumentstatus", label="dokumentstatus")
    dokumentkategori_rows = client.fetch_collection("Dokumentkategori", label="dokumentkategori")
    moedetype_rows = client.fetch_collection("M%C3%B8detype", label="moedetype")
    moedestatus_rows = client.fetch_collection("M%C3%B8destatus", label="moedestatus")

    log(options.verbose, f"fetching sambehandlinger for {len(sagstrin_ids)} sagstrin")
    sambehandling_rows = fetch_sambehandling_rows(client, sagstrin_ids=sagstrin_ids)
    first_stage_field = "førstesagstrinid"
    second_stage_field = "andetsagstrinid"
    stage_ids_from_sambehandling = {
        int(row.get(first_stage_field) or 0)
        for row in sambehandling_rows
    } | {
        int(row.get(second_stage_field) or 0)
        for row in sambehandling_rows
    }
    stage_ids_from_sambehandling = {item for item in stage_ids_from_sambehandling if item > 0}
    missing_relation_stage_ids = sorted(stage_ids_from_sambehandling - set(sagstrin_ids))
    relation_sagstrin_rows = list(timeline_sagstrin_rows)
    if missing_relation_stage_ids:
        log(
            options.verbose,
            f"fetching {len(missing_relation_stage_ids)} ekstra sagstrin til sambehandling",
        )
        relation_sagstrin_rows.extend(
            fetch_sagstrin_by_ids(client, sagstrin_ids=missing_relation_stage_ids)
        )
    relation_sagstrin_rows_by_id = {int(row["id"]): row for row in relation_sagstrin_rows}
    relation_sagstrin_rows = list(relation_sagstrin_rows_by_id.values())

    related_sag_ids: set[int] = set()
    for sag in sag_rows_by_id.values():
        fremsat_under_sag_id = int(sag.get("fremsatundersagid") or 0)
        delt_under_sag_id = int(sag.get("deltundersagid") or 0)
        if fremsat_under_sag_id > 0:
            related_sag_ids.add(fremsat_under_sag_id)
        if delt_under_sag_id > 0:
            related_sag_ids.add(delt_under_sag_id)

    relation_stage_to_sag = {
        int(row["id"]): int(row["sagid"])
        for row in relation_sagstrin_rows
        if row.get("id") is not None and row.get("sagid") is not None
    }
    for row in sambehandling_rows:
        first_stage_id = int(row.get(first_stage_field) or 0)
        second_stage_id = int(row.get(second_stage_field) or 0)
        first_sag_id = relation_stage_to_sag.get(first_stage_id)
        second_sag_id = relation_stage_to_sag.get(second_stage_id)
        if first_sag_id:
            related_sag_ids.add(first_sag_id)
        if second_sag_id:
            related_sag_ids.add(second_sag_id)

    extra_related_sag_ids = sorted(related_sag_ids - set(sag_rows_by_id))
    if extra_related_sag_ids:
        log(options.verbose, f"fetching {len(extra_related_sag_ids)} relaterede sager")
        extra_sag_rows = fetch_sager_by_ids(client, sag_ids=extra_related_sag_ids)
        sag_rows_by_id.update({int(row["id"]): row for row in extra_sag_rows})

    related_cases_by_sag = build_related_cases_by_sag(
        primary_sag_ids=sag_ids,
        sag_rows_by_id=sag_rows_by_id,
        sagstrin_rows=relation_sagstrin_rows,
        sambehandling_rows=sambehandling_rows,
    )
    log(options.verbose, f"fetching case actor roles for {len(sag_ids)} sager")
    sag_actor_rows = fetch_sag_actor_rows(client, sag_ids=sag_ids)
    sag_actor_ids = sorted(
        {
            int(
                row_value(
                    row,
                    "aktørid",
                    "akt\u00f8rid",
                    "aktør_id",
                    "akt\u00f8r_id",
                    "aktoerid",
                    "aktoer_id",
                )
                or 0
            )
            for row in sag_actor_rows
        }
        - {0}
    )
    sag_actor_rows_by_id = {int(row["id"]): row for row in fetch_actors_by_ids(client, actor_ids=sag_actor_ids)}
    actor_type_lookup = build_id_label_lookup(actor_types, "type")
    sag_actor_role_lookup = build_id_label_lookup(sag_actor_role_rows, "rolle")
    sag_actor_roles_by_sag = build_sag_actor_roles_by_sag(
        sag_actor_rows=sag_actor_rows,
        sag_actor_role_lookup=sag_actor_role_lookup,
        actors_by_id=sag_actor_rows_by_id,
        actor_type_lookup=actor_type_lookup,
    )
    sag_type_lookup = build_id_label_lookup(sagstype_rows, "type")
    sag_status_lookup = build_id_label_lookup(sagsstatus_rows, "status")
    sag_category_lookup = build_id_label_lookup(sagskategori_rows, "kategori")

    log(options.verbose, f"fetching case documents for {len(sag_ids)} sager")
    sag_document_rows = fetch_sag_documents(client, sag_ids=sag_ids)

    log(options.verbose, f"fetching stage documents for {len(sagstrin_ids)} sagstrin")
    sagstrin_document_rows = fetch_sagstrin_documents(client, sagstrin_ids=sagstrin_ids)
    document_ids = collect_document_ids(
        sag_document_rows=sag_document_rows,
        sagstrin_document_rows=sagstrin_document_rows,
    )
    log(options.verbose, f"fetching document provenance for {len(document_ids)} dokumenter")
    document_actor_rows = fetch_dokument_actor_rows(client, document_ids=document_ids)
    document_actor_ids = collect_document_actor_ids(document_actor_rows)
    document_actor_rows_by_id = {
        int(row["id"]): row
        for row in fetch_actors_by_ids(client, actor_ids=document_actor_ids)
    }
    document_actor_role_lookup = build_id_label_lookup(dokument_actor_role_rows, "rolle")
    document_type_lookup = build_id_label_lookup(dokument_type_rows, "type")
    document_status_lookup = build_id_label_lookup(dokument_status_rows, "status")
    document_category_lookup = build_id_label_lookup(dokumentkategori_rows, "kategori")
    document_rows_by_id = collect_document_records(
        sag_document_rows=sag_document_rows,
        sagstrin_document_rows=sagstrin_document_rows,
    )
    document_provenance_by_document_id = build_document_provenance_map(
        document_actor_rows=document_actor_rows,
        document_actor_role_lookup=document_actor_role_lookup,
        actors_by_id=document_actor_rows_by_id,
        actor_type_lookup=actor_type_lookup,
        document_rows_by_id=document_rows_by_id,
        document_type_lookup=document_type_lookup,
        document_status_lookup=document_status_lookup,
        document_category_lookup=document_category_lookup,
    )

    log(options.verbose, f"fetching omtryk for {len(document_ids)} dokumenter")
    omtryk_rows = fetch_omtryk_rows(client, document_ids=document_ids)
    omtryk_by_document_id = build_omtryk_map(omtryk_rows)

    case_document_links_by_sag = make_document_links(
        sag_document_rows,
        omtryk_by_document_id=omtryk_by_document_id,
    )
    document_links_by_sagstrin = make_sagstrin_document_links(
        sagstrin_document_rows,
        omtryk_by_document_id=omtryk_by_document_id,
    )
    case_document_links_by_sag = enrich_document_links_with_provenance(
        case_document_links_by_sag,
        document_provenance_by_document_id,
    )
    document_links_by_sagstrin = enrich_document_links_with_provenance(
        document_links_by_sagstrin,
        document_provenance_by_document_id,
    )
    stage_document_links_by_sag = make_case_document_links_from_sagstrin(
        sagstrin_rows=timeline_sagstrin_rows,
        stage_document_links_by_sagstrin=document_links_by_sagstrin,
    )
    log(options.verbose, f"fetching meeting context for {len(sagstrin_ids)} sagstrin")
    dagsordenspunkt_rows = fetch_dagsordenspunkt_rows(client, sagstrin_ids=sagstrin_ids)
    moede_ids = sorted(
        {
            int(
                row_value(
                    row,
                    "mødeid",
                    "m\u00f8deid",
                    "moedeid",
                )
                or 0
            )
            for row in dagsordenspunkt_rows
        }
        - {0}
    )
    moede_rows_by_id = {int(row["id"]): row for row in fetch_moeder_by_ids(client, moede_ids=moede_ids)}
    moede_type_lookup = build_id_label_lookup(moedetype_rows, "type")
    moede_status_lookup = build_id_label_lookup(moedestatus_rows, "status")
    meeting_context_by_sagstrin = build_meeting_context_by_sagstrin(
        dagsordenspunkt_rows=dagsordenspunkt_rows,
        moede_rows_by_id=moede_rows_by_id,
        moede_type_lookup=moede_type_lookup,
        moede_status_lookup=moede_status_lookup,
    )

    log(options.verbose, f"fetching emneord for {len(sag_ids)} sager")
    emneordsag_rows = fetch_emneordsag_rows(client, sag_ids=sag_ids)
    emneorddokument_rows = fetch_emneorddokument_rows(client, document_ids=document_ids)
    emneord_ids = sorted(
        {
            int(row["emneordid"])
            for row in emneordsag_rows + emneorddokument_rows
            if row.get("emneordid") is not None
        }
    )
    emneord_rows = fetch_emneord_rows(client, emneord_ids=emneord_ids)
    emneordstype_rows = client.fetch_collection("Emneordstype", label="emneordstype")
    emneord_lookup = build_emneord_lookup(emneord_rows, emneordstype_rows)
    sag_emneord_by_sag = build_sag_emneord_map(emneordsag_rows, emneord_lookup)
    document_emneord_by_document_id = build_document_emneord_map(emneorddokument_rows, emneord_lookup)

    document_links_by_sag: dict[int, list[dict[str, Any]]] = {}
    for sag_id in sorted(set(case_document_links_by_sag) | set(stage_document_links_by_sag)):
        merged_links = (case_document_links_by_sag.get(sag_id) or []) + (stage_document_links_by_sag.get(sag_id) or [])
        seen: set[str] = set()
        unique_links: list[dict[str, Any]] = []
        for link in merged_links:
            url = str(link.get("url") or "")
            if not url or url in seen:
                continue
            seen.add(url)
            unique_links.append(link)
        document_links_by_sag[sag_id] = unique_links

    vote_summaries = build_vote_context(sagstrin_rows, document_links_by_sag, afstemningstype_lookup)
    case_timelines = build_case_timelines(
        sagstrin_rows=timeline_sagstrin_rows,
        case_document_links_by_sag=document_links_by_sag,
        stage_document_links_by_sagstrin=document_links_by_sagstrin,
        sag_rows_by_id=sag_rows_by_id,
        related_cases_by_sag=related_cases_by_sag,
        sag_emneord_by_sag=sag_emneord_by_sag,
        document_emneord_by_document_id=document_emneord_by_document_id,
        sag_actor_roles_by_sag=sag_actor_roles_by_sag,
        sag_type_lookup=sag_type_lookup,
        sag_status_lookup=sag_status_lookup,
        sag_category_lookup=sag_category_lookup,
        meeting_context_by_sagstrin=meeting_context_by_sagstrin,
    )

    log(options.verbose, "fetching F/R sager from ODA API")
    min_period_kode = compute_min_period_kode(start_date)
    rf_docs = fetch_rf_sager(client, min_period_kode=min_period_kode)
    rf_docs.sort(key=lambda d: (
        d.get("type") or "",
        d.get("samling") or "",
        -(int(m.group()) if (m := re.search(r"\d+", d.get("nummer") or "")) else 0),
    ))

    profiles, party_summaries, committee_summaries, summarized_votes, derived_meta = derive_profiles(
        people=people,
        parties=parties,
        committees=committees,
        actor_relations=actor_relations,
        votes=vote_summaries,
        stems=stems,
        stemmetyper=stemmetype_lookup,
        recent_vote_limit=max(args.recent_votes, 1),
    )
    vote_overview, vote_details = split_vote_payloads(summarized_votes)
    vote_meta = build_vote_meta_rows(vote_overview)
    vote_ids_by_person = build_profile_vote_id_groups(
        summarized_votes,
        profile_ids={int(profile["id"]) for profile in profiles if int(profile.get("id") or 0) > 0},
    )
    vote_detail_index, vote_detail_shards = build_vote_detail_index_and_shards(vote_details)
    timeline_index, timeline_shards = build_timeline_index_and_shards(case_timelines)
    meeting_overview = build_meeting_overview(case_timelines)

    site_stats = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "Folketinget ODA API",
        "start_date": start_date,
        "vote_window": vote_window,
        "counts": {
            "people": derived_meta["profile_count"],
            "parties": derived_meta["party_count"],
            "committees": derived_meta["committee_count"],
            "actor_relations": len(actor_relations),
            "votes": len(summarized_votes),
            "individual_votes": len(stems),
            "profiles": derived_meta["profile_count"],
        },
    }
    meeting_overview["generated_at"] = site_stats["generated_at"]

    photos_dir = Path(args.output_dir).parent / "photos"
    if not args.skip_photos:
        apply_local_photo_inventory(profiles, photos_dir)

    write_json(output_dir / "profiler.json", profiles)
    write_json(output_dir / "partier.json", party_summaries)
    write_json(output_dir / "udvalg.json", committee_summaries)
    write_json(output_dir / "afstemninger.json", summarized_votes)
    write_json_compact(output_dir / "afstemninger_meta.json", vote_meta)
    write_json_compact(output_dir / "afstemninger_overblik.json", vote_overview)
    write_json_compact(output_dir / "afstemninger_detaljer.json", vote_details)
    write_json_compact(output_dir / "afstemninger_detaljer_index.json", vote_detail_index)
    write_json_shards(output_dir / "afstemninger_detaljer_shards", vote_detail_shards)
    write_profile_vote_id_files(
        output_dir / "profile_vote_ids",
        profiles=profiles,
        vote_ids_by_person=vote_ids_by_person,
    )
    write_json(output_dir / "moeder.json", meeting_overview)
    write_json(output_dir / "sag_tidslinjer.json", case_timelines)
    write_json_compact(output_dir / "sag_tidslinjer_index.json", timeline_index)
    write_json_shards(output_dir / "sag_tidslinjer_shards", timeline_shards)
    write_json(output_dir / "site_stats.json", site_stats)
    write_json(output_dir / "ft_dokumenter_rf.json", rf_docs)
    write_javascript_payload(
        output_dir.parent / "catalog.js",
        "__FOLKEVALGET_BOOTSTRAP__",
        {
            "profiles": profiles,
            "parties": party_summaries,
            "stats": site_stats,
        },
    )
    write_javascript_payload(
        output_dir.parent / "vote-catalog.js",
        "__FOLKEVALGET_VOTES__",
        {
            "votes": summarized_votes,
        },
    )

    if args.write_raw:
        write_json(raw_dir / "actor_types.json", actor_types)
        write_json(raw_dir / "stemmetyper.json", stemmetyper)
        write_json(raw_dir / "afstemningstyper.json", afstemningstyper)
        write_json(raw_dir / "aktorer_personer.json", people)
        write_json(raw_dir / "aktorer_partier.json", parties)
        write_json(raw_dir / "aktorer_udvalg.json", committees)
        write_json(raw_dir / "aktor_aktor.json", actor_relations)
        write_json(raw_dir / "sagstrin.json", sagstrin_rows)
        write_json(raw_dir / "stemmer.json", stems)
        write_json(raw_dir / "sag_dokumenter.json", sag_document_rows)
        write_json(raw_dir / "sagstrin_dokumenter.json", sagstrin_document_rows)

    print(
        json.dumps(
            {
                "ok": True,
                "output_dir": str(output_dir),
                "start_date": start_date,
                "profiles": len(profiles),
                "votes": len(summarized_votes),
                "timelines": len(case_timelines),
                "individual_votes": len(stems),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
