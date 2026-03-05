# IDEAS

Verified against live official endpoints on 2026-02-27.

## Project constraints to respect

- Official or otherwise highly reliable public data only.
- Static site on GitHub Pages, so all data must be prefetched into JSON.
- No AI summaries, no subjective scoring, no scraping-heavy pipeline.
- Neutral, source-first presentation.
- MVP should stay simple enough to ship before election day on 2026-03-24.

## Reliable sources to use

### 1. Folketingets aabne data (ODA)

Use this as the core source for the entire MVP.

Official endpoints:

- `https://www.ft.dk/dokumenter/aabne_data`
- `https://oda.ft.dk/api/`

Why it fits:

- Official parliamentary source.
- Open and unauthenticated.
- Works with a local/GitHub Actions batch fetch pipeline.
- Contains the core objects the site needs: people, parties, committees, votes, cases, documents.

Live schema notes:

- The service document is live at `https://oda.ft.dk/api/`.
- Entity names use UTF-8 names such as `Akt%C3%B8r`, not old ASCII aliases like `Aktoer`.
- `Akt%C3%B8rtype` is the authoritative lookup for actor type ids.
- On 2026-02-27, the live lookup says:
  - `3 = Udvalg`
  - `4 = Folketingsgruppe`
  - `5 = Person`
- This means the earlier project note with `typeid=4` for committees is stale.
- `Stemme` uses `afstemningid` and `akt%C3%B8rid`, not underscore field names.
- `Sagstrin` links a vote to its `Sag`.
- `SagDokument -> Dokument -> Fil.filurl` gives official PDFs for bill materials.

What we can build directly from ODA:

- Politician profiles:
  - `Akt%C3%B8r` where `typeid = 5`
- Party membership:
  - `Akt%C3%B8rAkt%C3%B8r` with `Akt%C3%B8rAkt%C3%B8rRolle`
  - current and historical memberships can be derived from relation start/end dates
- Committee memberships:
  - same relation model as above, filtered by related actor type `3`
- Vote lists:
  - `Afstemning`
- Individual votes:
  - `Stemme`
- Vote labels:
  - `Stemmetype`
- Vote context:
  - `Sagstrin`, `Sag`, `SagDokument`, `Dokument`, `Fil`

High-value implementation idea:

- Treat ODA as the source of truth for all core pages.
- Do not parse party or committee state from the HTML-like `biografi` blob unless there is no structured alternative.
- Prefer relation tables plus lookups, because they are easier to test and update.

### 2. Retsinformation API

Use this as optional legal enrichment, not as the MVP backbone.

Official docs:

- `https://retsinformation.dk/api`
- `https://retsinformation.dk/offentlig/vejledninger`
- `https://api.retsinformation.dk/swagger/v1/swagger.json`

Why it fits:

- Official legal source.
- Useful once a parliamentary case becomes actual law or is linked to legal material.
- Good for future "what became law?" features.

Live API notes:

- The OpenAPI doc is live at `https://api.retsinformation.dk/swagger/v1/swagger.json`.
- The documented endpoint currently exposed in the OpenAPI is `/v1/Documents`.
- The docs describe this as a harvest/update feed, not a broad search API.
- Constraints from the official OpenAPI description:
  - only callable between `03:00` and `23:45`
  - call at most once every `10 seconds`
  - `date` can only be within the last `10 days`
- A live request to `https://api.retsinformation.dk/v1/Documents?date=2026-02-27` returned current documents and XML hrefs.

What it is good for:

- Enrich enacted laws after they leave the parliamentary process.
- Attach legal follow-through to a bill or vote.
- Run a low-frequency daily sync, not a big historical backfill in the MVP path.

What it is not good for:

- Core politician and vote pages.
- Anything that needs lots of ad hoc querying during build time.

### 3. Danmarks Statistik / StatBank

Use this for official election context, not parliamentary behavior.

Official docs:

- `https://www.dst.dk/en/Statistik/hjaelp-til-statistikbanken/api`
- `https://api.statbank.dk/v1`

Why it fits:

- Official, stable, well-defined API.
- Good for aggregate context modules such as turnout, vote shares, and prior election results.
- Easy to fetch into static JSON.

Live API notes:

- `https://api.statbank.dk/v1/tables?format=JSON` returns the table catalog.
- `https://api.statbank.dk/v1/tableinfo/FVBPCT?format=JSON` and `.../FVPANDEL?...` return variable metadata.
- A live `POST` to `https://api.statbank.dk/v1/data` with JSON works.

Useful tables found:

- `FVPCT` - folketingsvalg percentages
- `FVBPCT` - folketingsvalg counts
- `FVKOM` - folketingsvalg by area
- `FVPANDEL` - party vote share by area and year
- `FVKAND` - candidates

What it is good for:

- "Context" widgets such as last election turnout and vote share by municipality.
- Future maps and election explainer modules.

What it is not good for:

- MP-level parliamentary behavior after the election.
- Attendance, party loyalty, or vote-by-vote politician analysis.

## Evaluated and accepted ideas

### Proposal timeline per case (from idea to law)

**Idea:** Build a timeline on each proposal/case page that shows the full
legislative flow (e.g., fremsættelse, 1. behandling, udvalgstrin, 2. behandling,
3. behandling, vedtaget/forkastet), with downloadable documents for each step.

**Evaluation result:** Accepted (fits constraints).

**Why it fits:**
- Uses documented public ODA API endpoints only (no scraping).
- Official and reliable source (Folketinget ODA).
- Objective and verifiable event chain (dates, step types, statuses, linked docs).
- Covers broad parliamentary process and is not limited to a small subset of MPs.
- Works in static-site pipeline (prefetch to JSON during build).

**Core ODA endpoints to combine:**
- `Sag` (proposal metadata: number/title/type/status/result)
- `Sagstrin` + `Sagstrinstype` + `Sagstrinsstatus` (ordered timeline steps)
- `SagstrinDokument -> Dokument -> Fil` (documents attached to specific steps)
- `SagDokument -> Dokument -> Fil` (case-level documents and attachments)
- `Afstemning` via `Sagstrin` expansion (vote IDs tied to step events)

**Implementation notes:**
- Prefer a dedicated derived file, e.g. `data/sag_timeline.json`, keyed by `sag_id`.
- Keep default UI compact: major milestones first, expandable details for all steps.
- Show only official links (PDF/FT documents) and clear source attribution.
- For performance, fetch timeline/docs targeted by relevant `sag_id` set instead of
  broad full-history document expansion in every run.

**References checked:** oda.ft.dk/api/,
oda.ft.dk/api/$metadata,
oda.ft.dk/api/Sag?$filter=nummer%20eq%20'L%2088',
oda.ft.dk/api/Sagstrin?$filter=sagid%20eq%20104068&$expand=Sagstrinstype,Sagstrinsstatus,Afstemning,
oda.ft.dk/api/SagstrinDokument?$filter=sagstrinid%20eq%20271190&$expand=Dokument/Fil,
oda.ft.dk/api/SagDokument?$filter=sagid%20eq%20104068&$expand=Dokument/Fil,SagDokumentRolle

---

## Evaluated and rejected ideas

### Politician popularity polls (Altinget/Epinion PDI-score)

**Idea:** Show a net favorability score (PDI: % positive minus % negative) for each MP,
sourced from the monthly Altinget/Epinion popularity barometer published on
altinget.dk and dr.dk.

**Rejected because:**
- No public API. Data lives inside Flourish chart embeds (`flo.uri.sh`) inside
  Altinget articles. Accessing it requires scraping, which violates the
  no-scraping constraint.
- Altinget is partially paywalled — scraping is also legally questionable.
- Only ~20–30 top politicians are covered (ministers + party leaders).
  The remaining ~150 MPs have no poll data at all.
- PDI is a subjective approval metric, which conflicts with the neutral,
  source-first presentation goal.
- Epinion transparency reports exist as PDFs only — not machine-readable.

**References checked:** altinget.dk/artikel/se-listen-her-er-de-mest-populaere-toppolitikere,
dr.dk/nyheder/politik/her-er-regeringens-mest-populaere-minister,
epinionglobal.com/da/transparensrapporter/

---

### Google Trends search interest

**Idea:** Use Google Trends search interest as a proxy popularity signal for each MP,
queryable per politician name.

**Rejected because:**
- The official Google Trends API (launched July 2025) is still alpha and
  application-only — not publicly accessible.
- The unofficial `pytrends` library reverse-engineers the Google Trends website,
  violating Google's ToS and breaking regularly.
- Data quality degrades sharply for lesser-known MPs (near-zero search volume,
  meaningless signal for ~150 of 179 members).
- Common Danish names create ambiguity (e.g., "Lars Jensen").
- Trends scores (0–100) are normalized per query batch, making cross-politician
  comparison across batches unreliable.
- Measures media attention, not anything parliamentary — a scandal spike looks
  identical to a popularity spike.

**References checked:** developers.google.com/search/apis/trends,
developers.google.com/search/blog/2025/07/trends-api

---

### Politikeres argument for egen afstemning (per stemme)

**Idea:** Vis en kort begrundelse fra hver politiker for, hvorfor vedkommende
stemte for/imod i en konkret afstemning.

**Rejected as core feature because:**
- ODA `Stemme` (individuel stemme) indeholder kun tekniske felter
  (`id`, `typeid`, `afstemningid`, `aktørid`, `opdateringsdato`) og ingen
  personlig begrundelse/argumenttekst.
- ODA `Afstemning.kommentar` er en afstemningsnote på samlet niveau, ikke en
  individuel forklaring per MF.
- ODA `Sag.begrundelse` beskriver sagens/lovforslagets begrundelse, ikke hvorfor
  en bestemt MF stemte, som vedkommende gjorde.
- Der findes ikke en dokumenteret officiel API-kilde med fuld dækning af
  individuelle stemmebegrundelser for alle 179 MF'er på tværs af afstemninger.
- Man kan kun lave indirekte kontekst via taler/debatter, men det vil være
  inferens (ikke objektivt "MF's begrundelse for denne stemme") og dækningen er
  ikke stabil per afstemning.

**Possible limited alternative (not the same feature):**
- Link til relevant sag, ordførerindlæg eller mødetaler som kontekst, tydeligt
  mærket som "relateret debat" og ikke som personlig stemmebegrundelse.

**References checked:** oda.ft.dk/api/$metadata,
oda.ft.dk/api/Afstemning?$filter=id%20eq%2010570&$expand=Sagstrin,Sagstrin/Sag,
oda.ft.dk/api/Stemme?$filter=afstemningid%20eq%2010570

---

### EUsag as a core module right now

**Idea:** Build a dedicated EU case module from `EUsag`.

**Rejected for now because:**
- Live endpoint currently returns zero rows, so there is no usable coverage.
- A core module with no records would create empty UX and maintenance overhead.
- Better to keep this as a future toggle once data appears.

**References checked (2026-03-05):**
- `https://oda.ft.dk/api/` (service document lists `EUsag`)
- `https://oda.ft.dk/api/EUsag?$top=5` (live result count: 0)

---

### MødeAktør as an MP attendance metric

**Idea:** Use `MødeAktør` to compute individual attendance/participation scores.

**Rejected as a core metric because:**
- Sampled rows mostly attach meetings to institutional actors (e.g., Folketinget, udvalg), not complete person attendance.
- This makes it easy to misinterpret as person attendance and would conflict with neutral/accurate presentation.
- Can still be used as contextual metadata, but not as a ranking KPI.

**References checked (2026-03-05):**
- `https://oda.ft.dk/api/M%C3%B8deAkt%C3%B8r?$top=20`
- `https://oda.ft.dk/api/Akt%C3%B8r` (type mapping on sampled actor ids)

---

## Evaluated and accepted ideas (second pass, 2026-03-05)

### Case actor roles on each proposal (forslagsstillere, relevant udvalg, minister)

**Idea:** Show official actor roles on each case so users can see who tabled the proposal and which actors are attached to it.

**Evaluation result:** Accepted.

**Why it fits:**
- Official documented ODA entities only.
- Objective and verifiable role data.
- High user value for case context with no subjective scoring.
- Works in static prefetch pipeline.

**Key endpoints:**
- `SagAktør`
- `SagAktørRolle`
- `Aktør`

**References checked (2026-03-05):**
- `https://oda.ft.dk/api/SagAkt%C3%B8r?$filter=sagid%20eq%20104847`
- `https://oda.ft.dk/api/SagAkt%C3%B8rRolle`
- `https://oda.ft.dk/api/Akt%C3%B8r`

---

### Document provenance for question/answer chains

**Idea:** For case documents, show who asked a question and who answered (where present), and include document type/status metadata.

**Evaluation result:** Accepted.

**Why it fits:**
- Official documented ODA entities only.
- Objective attribution of document actors and roles.
- Broadly applicable across many cases with committee/material flow.
- Strong transparency value without editorial interpretation.

**Key endpoints:**
- `DokumentAktør`
- `DokumentAktørRolle`
- `Dokumenttype`
- `Dokumentstatus`
- `Dokumentkategori`
- `SagDokument` / `SagstrinDokument`

**References checked (2026-03-05):**
- `https://oda.ft.dk/api/DokumentAkt%C3%B8r?$filter=dokumentid%20eq%201153623`
- `https://oda.ft.dk/api/DokumentAkt%C3%B8rRolle`
- `https://oda.ft.dk/api/Dokumenttype`

---

### Meeting and agenda context on timeline steps

**Idea:** Enrich proposal timeline steps with meeting context: agenda item number, meeting type/status, and timestamp.

**Evaluation result:** Accepted.

**Why it fits:**
- Official documented ODA entities only.
- Objective procedural metadata.
- Helps users understand where in parliamentary process a step happened.
- Can be prefetched and linked by `sagstrinid`.

**Key endpoints:**
- `Dagsordenspunkt`
- `DagsordenspunktSag`
- `Møde`
- `Mødetype`
- `Mødestatus`

**References checked (2026-03-05):**
- `https://oda.ft.dk/api/Dagsordenspunkt?$filter=sagstrinid%20eq%20271200`
- `https://oda.ft.dk/api/DagsordenspunktSag?$filter=dagsordenspunktid%20eq%20100510`
- `https://oda.ft.dk/api/M%C3%B8de?$filter=id%20eq%2015496`

---

### Official taxonomy filters (case type/status/category)

**Idea:** Add filters and labels based on official lookup tables instead of only inferred prefixes.

**Evaluation result:** Accepted.

**Why it fits:**
- Official documented ODA lookups.
- Objective and stable coding of procedural state.
- Improves precision of filtering and UI wording.

**Key endpoints:**
- `Sagstype`
- `Sagsstatus`
- `Sagskategori`

**References checked (2026-03-05):**
- `https://oda.ft.dk/api/Sagstype`
- `https://oda.ft.dk/api/Sagsstatus`
- `https://oda.ft.dk/api/Sagskategori`

---

### Law follow-through fields on adopted cases

**Idea:** Show legal follow-through fields when available (`lovnummer`, `lovnummerdato`, `retsinformationsurl`, `afgørelsesdato`).

**Evaluation result:** Accepted.

**Why it fits:**
- Comes from official ODA `Sag` fields.
- Objective and highly relevant for "from proposal to law" storyline.
- No credentials or scraping required.

**Key endpoint:**
- `Sag`

**References checked (2026-03-05):**
- `https://oda.ft.dk/api/Sag?$top=1`

---

## Sources to avoid as dependencies for MVP

- Non-official aggregator sites.
- Sources without a documented public API.
- Any source that forces scraping of unstable HTML.
- Anything requiring credentials or contract access.

These can still be used for inspiration, but not as the data backbone.

## Best source strategy for this project

### MVP

Use ODA only.

That is enough for:

- all politicians
- all parties
- committee memberships
- vote history
- attendance/fravaer
- party loyalty
- bill context
- source links to parliamentary materials

### Nice-to-have after MVP

- Add StatBank for election context modules.
- Add Retsinformation only for enacted-law enrichment or "what happened after passage?" views.

## Implementation ideas that fit the constraints

### Idea 1. Canonical raw snapshot + derived frontend JSON

Pipeline:

1. Fetch raw ODA entities into `data/raw/`.
2. Build a cleaned internal model in Python.
3. Emit small frontend-friendly files in `data/`.

Suggested raw files:

- `data/raw/aktorer.json`
- `data/raw/aktor_aktor.json`
- `data/raw/aktor_types.json`
- `data/raw/afstemninger.json`
- `data/raw/stemmer.json`
- `data/raw/stemmetyper.json`
- `data/raw/sager.json`
- `data/raw/sagstrin.json`
- `data/raw/sag_dokumenter.json`

Suggested frontend files:

- `data/profiler.json`
- `data/afstemninger.json`
- `data/partier.json`
- `data/udvalg.json`
- `data/site_stats.json`

Why:

- Keeps source fidelity.
- Makes debugging much easier.
- Lets the frontend stay simple and fast.

### Idea 2. Build profiles from structured relations, not biography blobs

For each person actor:

- find current party by active `Akt%C3%B8rAkt%C3%B8r` relation to actor type `4`
- find committees by active relation to actor type `3`
- compute vote totals from `Stemme`
- compute attendance from `Stemmetype`
- compute party loyalty by comparing each vote to the majority vote inside the politician's party on that date

Important detail:

- Membership must be date-aware.
- A politician can move party or committee across periods, so the relation active on the vote date should win.

### Idea 3. Enrich each vote with parliamentary context

For each `Afstemning`:

- join `Sagstrin`
- join `Sag`
- join `SagDokument`
- attach a short list of official documents with `Fil.filurl` when available

This gives:

- vote title/context
- case number (`L 120`, `V 29`, etc.)
- date
- official PDF links

That is enough to make each vote page useful without editorial summaries.

### Idea 4. Ship "controversial votes" without AI

Controversy signals can be derived from ODA only:

- close margin
- many absences
- party splits
- government vs opposition split
- votes where an MP broke from party majority

This is strong editorial value without adding opinions.

### Idea 5. "Match mig" can still be neutral

Use only actual recorded votes.

Flow:

1. pick 10-20 high-signal votes
2. show the official case title and source link
3. let user choose `for`, `imod`, `hverken`, or `spring over`
4. compare against politician vote records
5. rank by match percentage

This fits the project because:

- no AI summarization is required
- all logic is deterministic
- every answer can link back to the underlying vote

## Concrete implementation path

### Phase 1. Lock the ODA fetch model

- fetch lookup tables first:
  - `Akt%C3%B8rtype`
  - `Stemmetype`
  - `Afstemningstype`
- fetch actors and actor relations:
  - `Akt%C3%B8r`
  - `Akt%C3%B8rAkt%C3%B8r`
- fetch parliamentary events:
  - `Afstemning`
  - `Stemme`
  - `Sagstrin`
  - `Sag`
  - `SagDokument`

### Phase 2. Build derived models

- `members_by_id`
- `party_membership_by_member_and_date`
- `committee_membership_by_member_and_date`
- `votes_by_member`
- `party_majority_by_vote`
- `case_context_by_vote`

### Phase 3. Emit frontend JSON

For the frontend, prefer denormalized records over many joins in the browser.

Example profile fields:

- `id`
- `name`
- `party`
- `party_short`
- `constituency_or_role`
- `committees`
- `attendance_pct`
- `votes_for`
- `votes_against`
- `votes_absent`
- `party_loyalty_pct`
- `recent_votes`
- `source_links`

## Key corrections to carry into implementation

- Do not trust the old type-id notes blindly.
- Do not trust old underscore field names for ODA entities.
- Use the live lookup tables and metadata as the schema source.
- Prefer encoded endpoint names such as `Akt%C3%B8r` in scripts to avoid shell/encoding surprises.

## Recommended next coding step

Implement or update `scripts/fetch_data.py` around the verified ODA schema first.

Order:

1. lookup tables
2. actors and relations
3. votes
4. case context
5. derived profile builder

Only after that:

1. add StatBank context widgets
2. add optional Retsinformation enrichment

---

## 2026-03-05 feature evaluation: "sycophancy ratio"

### Proposal

Show whether a politician "regularly votes with proposals that already succeed/fail"
as a ratio.

### Checklist evaluation

1. Documented public API:
- Yes, possible with existing ODA entities already in use (`Afstemning`, `Stemme`,
  `Sagstrin`, `Sag`).

2. Scraping or unstable reverse-engineered endpoints:
- No scraping required.

3. Coverage across MPs:
- Yes, full coverage where recorded votes exist.

4. Official/reliable source:
- Yes, Folketinget ODA.

5. Objective and verifiable:
- Raw counts are objective; the label "sycophancy" is not neutral and is editorial.

6. Credentials/contracts/gated access:
- No, open API.

7. Documentation outcome:
- Logged here (accepted neutral variant + rejected framing).

### Decision

Accepted as a neutral metric, rejected as a "sycophancy" score.

### Accepted implementation variant

Use neutral naming such as:
- `Votede med udfald`
- `Votede mod udfald`
- split by vote type (`For`, `Imod`, optionally `Hverken`)

Rules:
- Exclude `Fravær` from the ratio denominator.
- Only include votes with clear `vedtaget/forkastet` outcome.
- Show raw counts + percentage and link to underlying votes.
- Add context text to avoid normative interpretation.

### Rejected framing

"Sycophancy ratio" is rejected as a core label because it violates neutral,
source-first wording and implies intent/motivation not present in the data.

### Sources checked

- https://www.ft.dk/dokumenter/aabne_data
- https://oda.ft.dk/api/
- https://oda.ft.dk/api/$metadata
- https://oda.ft.dk/api/Afstemning
- https://oda.ft.dk/api/Stemme

---

## 2026-03-05 benchmark evaluation against politikdata.dk

Scope: identify features worth copying while preserving Folkevalget's neutral, source-first ethos.

### Sources checked

- https://politikdata.dk/
- https://politikdata.dk/guide
- https://politikdata.dk/medloberi/personer
- https://politikdata.dk/medloberi/partier
- https://politikdata.dk/for-stemmende-politikere
- https://politikdata.dk/modsat-flertal-politikere
- https://politikdata.dk/partier/konformitet
- https://politikdata.dk/partier/dissens
- https://politikdata.dk/kandidattest
- https://oda.ft.dk/api/
- https://oda.ft.dk/api/$metadata
- https://oda.ft.dk/api/M%C3%B8de?$top=1

### Evaluated and accepted ideas

### A. Party agreement matrix ("how often party A and B vote the same")

Proposal:
- Add a neutral compare view for parties based on shared votes and vote-type overlap.

Checklist:
- Public documented API: Yes (ODA `Afstemning`, `Stemme`, party memberships).
- Scraping/reverse engineering: No.
- Coverage across MPs: Yes.
- Official/reliable source: Yes (ODA).
- Objective/verifiable: Yes (counts, percentages, denominators).
- Credentials/contracts: No.

Decision:
- Accepted.

Neutral naming:
- `Stemmesammenfald mellem partier`.

### B. MP-vs-MP comparison view

Proposal:
- Select two MPs and compare vote overlap, divergence, attendance and party-line breaks.

Checklist:
- Public documented API: Yes.
- Scraping/reverse engineering: No.
- Coverage across MPs: Yes (all MPs with recorded votes).
- Official/reliable source: Yes.
- Objective/verifiable: Yes.
- Credentials/contracts: No.

Decision:
- Accepted.

Neutral naming:
- `Sammenlign profiler`.

### C. "Votede med udfald" / "votede mod udfald" tables

Proposal:
- Add sortable lists showing how often a member/party vote matched final outcome.

Checklist:
- Public documented API: Yes.
- Scraping/reverse engineering: No.
- Coverage across MPs: Yes.
- Official/reliable source: Yes.
- Objective/verifiable: Yes, if method is fully documented.
- Credentials/contracts: No.

Decision:
- Accepted, with neutral framing only.

Required context copy:
- Exclude `Fravaer` from denominator.
- Show raw counts + percentage + vote links.
- Explain that "with outcome" does not imply motivation.

### D. Candidate-test style "find nearest vote profile"

Proposal:
- Guided questionnaire where users pick positions on real recorded votes, then see similarity % to MPs/parties.

Checklist:
- Public documented API: Yes.
- Scraping/reverse engineering: No.
- Coverage across MPs: Yes.
- Official/reliable source: Yes.
- Objective/verifiable: Yes (deterministic scoring against recorded votes).
- Credentials/contracts: No.

Decision:
- Accepted.

Guardrails:
- Use real vote text + source links.
- No AI-generated issue summaries.
- Label as `stemme-match`, not endorsement.

### E. Meeting and agenda overview page

Proposal:
- Add "kommende/moedehistorik" overview using ODA meeting entities.

Checklist:
- Public documented API: Yes (`M%C3%B8de`, `M%C3%B8deAkt%C3%B8r`, `M%C3%B8destatus`, `M%C3%B8detype`).
- Scraping/reverse engineering: No.
- Coverage across MPs: Broad parliamentary coverage.
- Official/reliable source: Yes.
- Objective/verifiable: Yes.
- Credentials/contracts: No.

Decision:
- Accepted.

### F. Download center for predefined neutral CSV extracts

Proposal:
- Provide downloadable slices (e.g. all votes this session, all votes for one MP, party splits).

Checklist:
- Public documented API: Yes (derived from existing ODA pipeline).
- Scraping/reverse engineering: No.
- Coverage across MPs: Yes.
- Official/reliable source: Yes.
- Objective/verifiable: Yes.
- Credentials/contracts: No.

Decision:
- Accepted.

---

## 2026-03-05 feature evaluation: Daily Change Feed + favorites/watchlist

### Proposal

- Add a `Daily Change Feed` showing:
  - new votes
  - corrected documents (`omtryk`)
  - party-split changes
  - status on active cases
- Let users favorite/follow:
  - cases (active or archived)
  - politicians
- Show update indicators when followed items get new activity.

### Checklist evaluation

1. Documented public API:
- Yes, based on existing ODA entities already used in pipeline (`Afstemning`, `Sag`, `Sagstrin`, `Dokument` links and timeline index outputs).

2. Scraping or unstable reverse-engineered endpoints:
- No.

3. Coverage across MPs:
- Yes, full MP/case coverage within the fetched dataset.

4. Official/reliable source:
- Yes, Folketinget ODA-derived dataset.

5. Objective and verifiable:
- Yes, feed events are concrete registry changes (dates/status/documents/vote records), no subjective scoring.

6. Credentials/contracts/gated access:
- No.

7. Documentation outcome:
- Logged here as accepted.

### Decision

Accepted.

### Implementation guardrails

- Keep it neutral and source-first:
  - no intent labels
  - no popularity/approval framing
- Keep watchlist local (client-side localStorage) to preserve static-site architecture.
- Link every feed row and favorite item back to a concrete case/profile/vote page and official source where possible.

### Sources checked

- https://oda.ft.dk/api/
- https://oda.ft.dk/api/$metadata
- Existing generated files in repo:
  - `data/afstemninger_overblik.json`
  - `data/sag_tidslinjer_index.json`

---

## Evaluated and rejected ideas

### Normative ranking labels (medlober, kontraer, status quo) as primary UX

Proposal:
- Copy value-loaded labels and default top/bottom ranking framing.

Rejected because:
- Violates neutral wording goal and implies motives/virtue judgments.
- Encourages editorial interpretation over source-first exploration.
- Can be replaced by objective labels already accepted above.

Alternative:
- Keep equivalent math but present as neutral metrics (`med udfald`, `mod udfald`, `partisammenfald`, `dissens`).

Sources checked:
- https://politikdata.dk/guide
- https://politikdata.dk/medloberi/personer
- https://politikdata.dk/medloberi/partier

---

### Paragraph lookup in global search

Proposal:
- Let users search for Danish legal paragraphs directly from the global search bar,
  for example `straffeloven § 266 b` or `forvaltningsloven § 19`, using an official
  public API.

Rejected because:
- No documented public paragraph-lookup API was found that fits the project's
  constraints.
- Retsinformation's official open REST API is documented as a harvest/update feed,
  not as a broad public paragraph lookup or text-search API.
- Retsinformation's public ELI channels are also documented as update channels for
  legal documents, not as a paragraph query endpoint.
- The official `Generisk webservice til søgning af afgørelser` is gated and requires
  an agreement with Civilstyrelsen, so it cannot be used in the static-site pipeline.
- A useful paragraph-search feature would therefore require building and maintaining
  our own derived legal-text index from official materials, which is much larger in
  scope than simply tethering an external API into global search.

Possible later alternative:
- Support official law/document lookup by title or identifier first.
- Revisit paragraph search only if the project explicitly expands into build-time
  legal text indexing from official sources.

Sources checked:
- https://www.retsinformation.dk/static/api.html
- https://api.retsinformation.dk/swagger/v1/swagger.json
- https://www.retsinformation.dk/offentlig/vejledning/Retsinformation%20REST%20API%20vejledning.pdf
- https://www.retsinformation.dk/offentlig/vejledning/Generisk_webservice_til_s%C3%B8gning_af_afg%C3%B8relser-Vejledning.pdf
