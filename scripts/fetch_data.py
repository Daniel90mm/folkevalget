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
    return parser.parse_args()


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, payload: Any) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_javascript_payload(path: Path, variable_name: str, payload: Any) -> None:
    ensure_dir(path.parent)
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    path.write_text(f"window.{variable_name}={serialized};\n", encoding="utf-8")


def parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value[:10])


def round_pct(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return round((numerator / denominator) * 100, 1)


def extract_tag(blob: str | None, tag: str) -> str | None:
    if not blob:
        return None
    match = re.search(rf"<{tag}>(.*?)</{tag}>", blob, flags=re.DOTALL)
    if not match:
        return None
    text = re.sub(r"<[^>]+>", "", match.group(1))
    text = html.unescape(text).strip()
    return text or None


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
    constituency = extract_tag(biography, "currentConstituency") or extract_tag(biography, "constituency")
    return {
        "member_url": normalize_member_url(extract_tag(biography, "url")),
        "photo_url": normalize_photo_url(extract_tag(biography, "pictureMiRes"))
        or normalize_photo_url(extract_tag(biography, "pictureHiRes")),
        "profession": extract_tag(biography, "profession"),
        "title": extract_tag(biography, "title"),
        "current_constituency": constituency,
        "party_short_from_bio": extract_tag(biography, "partyShortname"),
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
            "$expand": "Afstemning,Afstemning/Stemme,Sag,Sagstrinstype",
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
    rows: list[dict[str, Any]] = []
    chunk_size = 20
    for start in range(0, len(sag_ids), chunk_size):
        chunk = sag_ids[start : start + chunk_size]
        filter_expr = build_filter_for_ids("sagid", chunk)
        rows.extend(
            client.fetch_collection(
                "SagDokument",
                params={
                    "$filter": filter_expr,
                    "$expand": "Dokument/Fil,SagDokumentRolle",
                },
                label="sagdokument",
            )
        )
        time.sleep(client.options.delay)
    return rows


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


def make_document_links(sag_document_rows: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    links_by_sag: dict[int, list[dict[str, Any]]] = defaultdict(list)

    for row in sag_document_rows:
        sag_id = int(row["sagid"])
        document = row.get("Dokument") or {}
        files = document.get("Fil") or []
        for file_row in files:
            url = file_row.get("filurl")
            if not url:
                continue
            links_by_sag[sag_id].append(
                {
                    "document_id": int(document["id"]),
                    "title": document.get("titel"),
                    "url": url,
                    "format": file_row.get("format"),
                    "variant_code": file_row.get("variantkode"),
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
                    "sag_id": sag_id,
                    "sag_title": sag.get("titel"),
                    "sag_short_title": sag.get("titelkort"),
                    "sag_number": sag.get("nummer"),
                    "sag_type_id": sag.get("typeid"),
                    "source_documents": sag_documents[:3],
                }
            )

    votes.sort(key=lambda item: (item["date"], item["afstemning_id"]), reverse=True)
    return votes


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
                "member_url": bio_fields.get("member_url"),
                "photo_url": bio_fields.get("photo_url"),
                "photo_source_url": None,
                "photo_source_name": None,
                "photo_photographer": None,
                "photo_credit_text": None,
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
    document_links_by_sag: dict[int, list[dict[str, Any]]] = {}
    vote_summaries = build_vote_context(sagstrin_rows, document_links_by_sag, afstemningstype_lookup)

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

    photos_dir = Path(args.output_dir).parent / "photos"
    if not args.skip_photos:
        apply_local_photo_inventory(profiles, photos_dir)

    write_json(output_dir / "profiler.json", profiles)
    write_json(output_dir / "partier.json", party_summaries)
    write_json(output_dir / "udvalg.json", committee_summaries)
    write_json(output_dir / "afstemninger.json", summarized_votes)
    write_json(output_dir / "site_stats.json", site_stats)
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
        write_json(raw_dir / "sag_dokumenter.json", [])

    print(
        json.dumps(
            {
                "ok": True,
                "output_dir": str(output_dir),
                "start_date": start_date,
                "profiles": len(profiles),
                "votes": len(summarized_votes),
                "individual_votes": len(stems),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
