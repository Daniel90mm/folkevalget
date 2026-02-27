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
