#!/usr/bin/env python3
"""Build a prioritised review report for unresolved CVR person matches."""

from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
REPORTS_DIR = ROOT / "reports"

CVR_FILE = DATA_DIR / "cvr_personer.json"
PROFILES_FILE = DATA_DIR / "profiler.json"
JSON_REPORT = REPORTS_DIR / "cvr_unresolved_review.json"
MARKDOWN_REPORT = REPORTS_DIR / "cvr_unresolved_review.md"


@dataclass
class ReviewEntry:
    rank: int
    score: int
    status: str
    member_id: int
    name: str
    official_name: str | None
    member_url: str | None
    ft_search_url: str
    virk_search_url: str
    candidate_count: int
    person_total: int
    company_cvr_count: int
    company_name_count: int
    verified_company_count: int
    candidate_names: list[str]
    candidate_urls: list[str]
    company_name_samples: list[str]
    company_cvr_samples: list[str]
    search_names_tried: list[str]
    next_step: str
    reasons: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "rank": self.rank,
            "score": self.score,
            "status": self.status,
            "id": self.member_id,
            "name": self.name,
            "official_name": self.official_name,
            "member_url": self.member_url,
            "ft_search_url": self.ft_search_url,
            "virk_search_url": self.virk_search_url,
            "candidate_count": self.candidate_count,
            "person_total": self.person_total,
            "company_cvr_count": self.company_cvr_count,
            "company_name_count": self.company_name_count,
            "verified_company_count": self.verified_company_count,
            "candidate_names": self.candidate_names,
            "candidate_urls": self.candidate_urls,
            "company_name_samples": self.company_name_samples,
            "company_cvr_samples": self.company_cvr_samples,
            "search_names_tried": self.search_names_tried,
            "next_step": self.next_step,
            "reasons": self.reasons,
        }


def normalise(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r"[^0-9A-Za-z]+", " ", text).strip().lower()
    return re.sub(r"\s+", " ", text)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def build_ft_search_url(query: str) -> str:
    encoded = quote(query or "", safe="")
    return f"https://www.ft.dk/da/search?as=1&msf=mf&pageNr=1&pageSize=25&q={encoded}&sf=mf"


def build_virk_search_url(query: str) -> str:
    encoded = quote(query or "", safe="")
    return f"https://datacvr.virk.dk/soegeresultater?fritekst={encoded}&sideIndex=0&size=10"


def pick_next_step(
    status: str,
    candidate_count: int,
    company_cvr_count: int,
    company_name_count: int,
    official_name_differs: bool,
) -> str:
    if company_cvr_count:
        return "Søg virksomhederne direkte i Virk via CVR-numre og sammenhold personrelationer med medlemmet."
    if company_name_count:
        return "Søg de erklærede virksomhedsnavne direkte i Virk og match personrelationer mod officielle hverv."
    if status == "ambiguous" and candidate_count <= 3 and official_name_differs:
        return "Brug flere officielle navnekilder til at afklare mellemnavn eller ekstra efternavn."
    if status == "ambiguous" and candidate_count <= 3:
        return "Gennemgå de få Virk-kandidater manuelt mod officielle kilder som ft.dk og eventuelle ministerbiografier."
    if official_name_differs:
        return "Prøv flere officielle navnevarianter og historiske medlemssider før manuel override."
    if status == "ambiguous":
        return "Indsaml flere officielle identitetsmarkører før der vælges en Virk-person."
    return "Ingen stærke spor endnu; kræver nye officielle kilder eller manuel verifikation."


def score_entry(
    status: str,
    candidate_count: int,
    person_total: int,
    company_cvr_count: int,
    company_name_count: int,
    verified_company_count: int,
    official_name_differs: bool,
    has_member_url: bool,
) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    if status == "ambiguous":
        score += 35
        reasons.append("flere konkrete Virk-kandidater")
    elif person_total > 0:
        score += 18
        reasons.append("Virk gav persontræf uden sikker identitet")

    if candidate_count == 1:
        score += 30
        reasons.append("kun én kandidat at afklare")
    elif candidate_count == 2:
        score += 24
        reasons.append("to kandidater at afklare")
    elif 3 <= candidate_count <= 5:
        score += 14
        reasons.append("få kandidater at afklare")
    elif candidate_count > 5:
        score += 6
        reasons.append("mange kandidater gør sagen tungere")

    if company_cvr_count:
        score += 30 + min(company_cvr_count, 3) * 5
        reasons.append("officielle CVR-numre i hvervregisteret")
    elif company_name_count:
        score += 18 + min(company_name_count, 4) * 3
        reasons.append("officielle virksomhedsnavne i hvervregisteret")

    if official_name_differs:
        score += 18
        reasons.append("officielt fuldnavn er mere specifikt end profilnavnet")

    if has_member_url:
        score += 5
        reasons.append("officiel medlemsside findes")
    else:
        score -= 8
        reasons.append("mangler officiel medlemsside")

    if status == "not_found" and person_total == 0 and company_cvr_count == 0 and company_name_count == 0:
        score -= 10
        reasons.append("ingen kandidater og ingen virksomhedsspor")

    if verified_company_count:
        score -= 35 + min(verified_company_count, 5) * 2
        reasons.append("profilen har allerede verificerede virksomhedstræf")

    return score, reasons


def build_review_entries() -> tuple[dict[str, Any], list[ReviewEntry]]:
    cvr_data = load_json(CVR_FILE)["medlemmer"]
    profiles = {str(item["id"]): item for item in load_json(PROFILES_FILE)}

    entries: list[ReviewEntry] = []
    unresolved_status_counts = Counter()

    for member_id, item in cvr_data.items():
        status = item.get("status")
        if status not in {"not_found", "ambiguous"}:
            continue

        unresolved_status_counts[status] += 1
        profile = profiles.get(member_id, {})
        official_name = item.get("official_name")
        company_clues = item.get("verification_clues") or {}
        company_names = company_clues.get("company_names") or []
        company_cvrs = company_clues.get("company_cvrs") or []
        verified_companies = item.get("verified_companies") or []
        candidates = item.get("candidates") or []
        candidate_names = [candidate.get("name") for candidate in candidates if candidate.get("name")]
        candidate_urls = [candidate.get("person_url") for candidate in candidates if candidate.get("person_url")]
        search_names_tried = item.get("search_names_tried") or []
        if not search_names_tried and item.get("search_name_used"):
            search_names_tried = [item["search_name_used"]]
        primary_lookup_name = (
            search_names_tried[0]
            if search_names_tried
            else (official_name or item.get("name") or profile.get("name") or "")
        )
        official_name_differs = bool(official_name and normalise(official_name) != normalise(item.get("name")))

        score, reasons = score_entry(
            status=status,
            candidate_count=len(candidates),
            person_total=int(item.get("person_total") or 0),
            company_cvr_count=len(company_cvrs),
            company_name_count=len(company_names),
            verified_company_count=len(verified_companies),
            official_name_differs=official_name_differs,
            has_member_url=bool(profile.get("member_url")),
        )

        entries.append(
            ReviewEntry(
                rank=0,
                score=score,
                status=status,
                member_id=int(member_id),
                name=item.get("name") or profile.get("name") or "",
                official_name=official_name,
                member_url=profile.get("member_url"),
                ft_search_url=build_ft_search_url(official_name or item.get("name") or profile.get("name") or ""),
                virk_search_url=build_virk_search_url(primary_lookup_name),
                candidate_count=len(candidates),
                person_total=int(item.get("person_total") or 0),
                company_cvr_count=len(company_cvrs),
                company_name_count=len(company_names),
                verified_company_count=len(verified_companies),
                candidate_names=candidate_names[:5],
                candidate_urls=candidate_urls[:5],
                company_name_samples=company_names[:5],
                company_cvr_samples=company_cvrs[:5],
                search_names_tried=search_names_tried,
                next_step=pick_next_step(
                    status=status,
                    candidate_count=len(candidates),
                    company_cvr_count=len(company_cvrs),
                    company_name_count=len(company_names),
                    official_name_differs=official_name_differs,
                ),
                reasons=reasons,
            )
        )

    entries.sort(
        key=lambda entry: (
            entry.score,
            entry.company_cvr_count,
            entry.company_name_count,
            -entry.candidate_count,
            entry.status == "ambiguous",
            normalise(entry.name),
        ),
        reverse=True,
    )

    for index, entry in enumerate(entries, start=1):
        entry.rank = index

    summary = {
        "generated_from": {
            "cvr_file": str(CVR_FILE.relative_to(ROOT)),
            "profiles_file": str(PROFILES_FILE.relative_to(ROOT)),
        },
        "counts": {
            "unresolved_total": len(entries),
            "not_found": unresolved_status_counts.get("not_found", 0),
            "ambiguous": unresolved_status_counts.get("ambiguous", 0),
            "with_company_cvrs": sum(1 for entry in entries if entry.company_cvr_count),
            "with_company_names": sum(1 for entry in entries if entry.company_name_count),
            "with_verified_companies": sum(1 for entry in entries if entry.verified_company_count),
            "with_candidates": sum(1 for entry in entries if entry.candidate_count),
            "with_expanded_official_name": sum(
                1 for entry in entries if entry.official_name and normalise(entry.official_name) != normalise(entry.name)
            ),
        },
    }

    return summary, entries


def write_reports(summary: dict[str, Any], entries: list[ReviewEntry]) -> None:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    json_payload = {
        "summary": summary,
        "entries": [entry.to_dict() for entry in entries],
    }
    JSON_REPORT.write_text(json.dumps(json_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# CVR review af uløste navne",
        "",
        f"- Uløste sager: {summary['counts']['unresolved_total']}",
        f"- Ikke fundet: {summary['counts']['not_found']}",
        f"- Tvetydige: {summary['counts']['ambiguous']}",
        f"- Med CVR-spor fra hverv: {summary['counts']['with_company_cvrs']}",
        f"- Med virksomhedsnavne fra hverv: {summary['counts']['with_company_names']}",
        f"- Allerede beriget med verificerede virksomheder: {summary['counts']['with_verified_companies']}",
        f"- Med Virk-kandidater: {summary['counts']['with_candidates']}",
        f"- Med udvidet officielt navn: {summary['counts']['with_expanded_official_name']}",
        "",
        "## Top 25",
        "",
    ]

    for entry in entries[:25]:
        ft_links = []
        if entry.member_url:
            ft_links.append(f"[medlemsside]({entry.member_url})")
        ft_links.append(f"[ft-søgning]({entry.ft_search_url})")
        candidate_links = ", ".join(
            f"[{index}]({url})" for index, url in enumerate(entry.candidate_urls, start=1)
        ) or "—"
        lines.extend(
            [
                f"### {entry.rank}. {entry.name} ({entry.status}, score {entry.score})",
                f"- ID: `{entry.member_id}`",
                f"- Officielt navn: {entry.official_name or '—'}",
                f"- FT.dk: {' / '.join(ft_links)}",
                f"- Virk: [søgning]({entry.virk_search_url})",
                f"- Søgte navne: {', '.join(entry.search_names_tried) if entry.search_names_tried else '—'}",
                f"- Virk-kandidater: {entry.candidate_count} (personTotal: {entry.person_total})",
                f"- Kandidatlinks: {candidate_links}",
                f"- Virksomhedsnavne: {', '.join(entry.company_name_samples) if entry.company_name_samples else '—'}",
                f"- CVR-spor: {', '.join(entry.company_cvr_samples) if entry.company_cvr_samples else '—'}",
                f"- Verificerede virksomheder: {entry.verified_company_count}",
                f"- Kandidater: {', '.join(entry.candidate_names) if entry.candidate_names else '—'}",
                f"- Næste skridt: {entry.next_step}",
                f"- Hvorfor højt prioriteret: {', '.join(entry.reasons)}",
                "",
            ]
        )

    MARKDOWN_REPORT.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    summary, entries = build_review_entries()
    write_reports(summary, entries)
    print(f"Skrev {JSON_REPORT}")
    print(f"Skrev {MARKDOWN_REPORT}")
    print(json.dumps(summary["counts"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
