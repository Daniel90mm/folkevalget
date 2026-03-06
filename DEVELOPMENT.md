# Development Workflow

This repo is a static site with a generated `data/` layer. Keep the workflow small, deterministic, and easy to verify.

## Local commands

Install dependencies once:

```bash
npm install
npx playwright install chromium
```

Run the local site:

```bash
npm run dev
```

Run quick validation:

```bash
npm run check
```

Run browser smoke tests:

```bash
npm run test:smoke
```

Refresh the data snapshot incrementally:

```bash
npm run refresh:data
```

## Working rules

### Pushes

Do not push automatically. Push only when the user explicitly asks for it or when the task itself explicitly requires a push.

### Anti-boxification

When the user asks to remove boxes, borders, or to apply anti-boxification/no-boxification, the default meaning in this repo is:

- remove the outer border
- remove the tinted or lighter surface fill
- let the section sit on the page background
- keep only minimal separators required for scanability and hierarchy

Do not replace removed boxes with pill-shaped treatments.

### Validation

Before finishing a change that affects page behavior or data rendering, prefer this sequence:

1. `npm run check`
2. `npm run test:smoke`

If a change touches only one script, at minimum run the relevant syntax check and one browser smoke pass if the page behavior changed.

### Scope discipline

- Prefer extending the existing visual language over inventing a new one.
- Keep controls visible and direct on desktop.
- Avoid decorative UI chrome that does not improve comprehension.
- When adding data, favor objective and source-backed metrics over commentary.

## Data expectations

The validation script currently guards the most important invariants:

- `data/profiler.json` still contains exactly `179` current members
- vote overview data remains structurally complete
- committee, meeting, and party datasets retain the minimum fields the UI expects

If upstream data changes shape, update the validator in `scripts/check-data.mjs` at the same time as the page code.
