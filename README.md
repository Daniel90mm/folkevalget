# folkevalget

Static political transparency site for `folkevalget.dk`.

## Data flow

The site should not call Folketinget's API in the browser for every visitor.

Instead, the project uses a static snapshot pipeline:

1. `scripts/fetch_data.py` fetches official ODA data.
2. The script builds small derived JSON files in `data/`.
3. GitHub Pages serves those files as static assets.
4. Visitors only hit GitHub Pages, not the Folketinget API.

This keeps the site fast, keeps API usage polite, and makes the frontend deterministic.

## Local refresh

Run:

```bash
python scripts/fetch_data.py --start-date 2022-11-01 --write-raw --verbose
```

Derived site files are written to `data/`.

Optional raw snapshots are written to `data/raw/` and are ignored by git.

## Automated refresh

The GitHub Actions workflow refreshes the static JSON every 6 hours and can also be triggered manually.

It:

1. fetches fresh ODA data
2. rebuilds `data/*.json`
3. commits changed data back to `main`

That commit updates the files GitHub Pages serves.

## Current fetch scope

The current pipeline is tuned for the election-cycle use case:

- actors: people, parties, committees
- actor relations: party and committee memberships
- votes from `2022-11-01` onward
- vote context via `Sagstrin` and `Sag`

The scheduled build currently skips document-link enrichment because that part of ODA is much slower than the core vote pipeline. The static site still has official parliamentary context for each vote, and document linking can be added back later behind a more targeted fetch.

This keeps the scheduled job practical while still covering the current parliamentary term leading into the March 24, 2026 election.
