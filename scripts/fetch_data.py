#!/usr/bin/env python3
"""Fetch Folketinget ODA data and build static JSON for GitHub Pages."""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
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
        "--write-raw",
        action="store_true",
        help="Write raw snapshot files to raw-dir.",
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
    return {
        "member_url": normalize_member_url(extract_tag(biography, "url")),
        "photo_url": extract_tag(biography, "pictureMiRes") or extract_tag(biography, "pictureHiRes"),
        "profession": extract_tag(biography, "profession"),
        "title": extract_tag(biography, "title"),
        "current_constituency": extract_tag(biography, "currentConstituency"),
        "party_short_from_bio": extract_tag(biography, "partyShortname"),
    }


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
            "$expand": "Afstemning,Sag,Sagstrinstype",
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
            person_id = int(stem["aktørid"])
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
            person_id = int(stem["aktørid"])
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
        for stem in vote_stems:
            counts[int(stem["typeid"])] += 1

        summarized_votes.append(
            {
                **vote,
                "counts": {
                    "for": counts.get(1, 0),
                    "imod": counts.get(2, 0),
                    "fravaer": counts.get(3, 0),
                    "hverken": counts.get(4, 0),
                },
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
                "constituency": bio_fields.get("current_constituency"),
                "member_url": bio_fields.get("member_url"),
                "photo_url": bio_fields.get("photo_url"),
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
    earliest_vote_id = int(vote_window["first_vote_id"])

    log(options.verbose, "fetching vote data")
    raw_votes = client.fetch_collection(
        "Afstemning",
        params={"$filter": f"id ge {earliest_vote_id}"},
        label="afstemning",
    )
    raw_stems = client.fetch_collection(
        "Stemme",
        params={"$filter": f"afstemningid ge {earliest_vote_id}"},
        label="stemme",
    )

    allowed_vote_ids = {
        int(vote_row["id"])
        for sagstrin_row in sagstrin_rows
        for vote_row in (sagstrin_row.get("Afstemning") or [])
    }
    votes = [row for row in raw_votes if int(row["id"]) in allowed_vote_ids]
    stems = [row for row in raw_stems if int(row["afstemningid"]) in allowed_vote_ids]

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

    sag_ids = sorted({int(row["sagid"]) for row in sagstrin_rows})
    log(options.verbose, "fetching document links")
    sag_documents = fetch_sag_documents(client, sag_ids=sag_ids)

    stemmetype_lookup = collect_lookup_map(stemmetyper)
    afstemningstype_lookup = collect_lookup_map(afstemningstyper)
    document_links_by_sag = make_document_links(sag_documents)
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
            "people": len(people),
            "parties": len(parties),
            "committees": len(committees),
            "actor_relations": len(actor_relations),
            "votes": len(summarized_votes),
            "individual_votes": len(stems),
            "profiles": derived_meta["profile_count"],
        },
    }

    write_json(output_dir / "profiler.json", profiles)
    write_json(output_dir / "partier.json", party_summaries)
    write_json(output_dir / "udvalg.json", committee_summaries)
    write_json(output_dir / "afstemninger.json", summarized_votes)
    write_json(output_dir / "site_stats.json", site_stats)

    if args.write_raw:
        write_json(raw_dir / "actor_types.json", actor_types)
        write_json(raw_dir / "stemmetyper.json", stemmetyper)
        write_json(raw_dir / "afstemningstyper.json", afstemningstyper)
        write_json(raw_dir / "aktorer_personer.json", people)
        write_json(raw_dir / "aktorer_partier.json", parties)
        write_json(raw_dir / "aktorer_udvalg.json", committees)
        write_json(raw_dir / "aktor_aktor.json", actor_relations)
        write_json(raw_dir / "sagstrin.json", sagstrin_rows)
        write_json(raw_dir / "afstemninger.json", votes)
        write_json(raw_dir / "stemmer.json", stems)
        write_json(raw_dir / "sag_dokumenter.json", sag_documents)

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
