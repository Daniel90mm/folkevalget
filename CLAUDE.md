# Claude Code Instructions — Folkevalget.dk

## Design Language Compliance (MANDATORY)

**Before every UI change, addition, or removal**, read and comply with
`FOLKEVALGET_DESIGN_LANGUAGE.md`. No exceptions.

The design language document is the final authority on:
- Visual constants (colors, typography, spacing) — use only the CSS variables defined there
- Component rules (cards, badges, key-stats, buttons, tables) — do not invent new component patterns
- Interaction patterns (search, filters, sorting, links, empty states)
- Tone of voice and data presentation rules
- Information architecture and progressive disclosure

If a proposed UI change conflicts with the design language document,
the document wins. Flag the conflict to the user rather than silently
overstepping it.

## Box Removal / Anti-Boxification

When the user says things like `remove the box border`, `remove boxes`,
`anti-boxification`, or `no-boxification`, interpret that as a full
surface-flattening instruction, not a narrow border tweak.

That means:
- Remove the outer border
- Remove any tinted, lighter, or contrasting panel/card background
- Let the section sit directly on the page background
- Keep only the minimum structure needed for readability, such as spacing,
  hierarchy, row dividers, table separators, and meaningful accent rails

Do not leave behind a boxed look via `background: var(--color-surface)`,
inner wrapper panels, or secondary separator frames if those surfaces no
longer serve a clear scanning purpose.

## Project Context

Folkevalget is a static site (GitHub Pages) that makes Folketing data accessible
to ordinary Danish citizens. It is not a news site, not an opinion platform,
not an AI service.

**Tech stack:** Vanilla JS, plain CSS, pre-fetched JSON in `/data/`.
No frameworks, no build step, no server.

**Primary data source:** ODA API at oda.ft.dk + ft.dk HTML (scraped offline).
All data files live in `/data/` as static JSON.

## Local commands to prefer

Use the package scripts instead of one-off shell commands whenever they cover the task:

- `npm run dev` — local static dev server
- `npm run check` — JS syntax + data-shape validation
- `npm run test:smoke` — Playwright smoke tests for core pages
- `npm run refresh:data` — incremental data refresh
- `npm run refresh:data:full` — full rebuild from `2022-11-01`

Prefer `pwsh` over legacy Windows PowerShell when running local commands.

## GitHub Pages Deployment (MANDATORY)

Commit and push when the user explicitly asks for it, or when the task itself
explicitly requires a push. GitHub Pages deploys automatically from `main` —
no separate deploy step is needed.

```
git add <changed files>
git commit -m "..."
git push
```

Do not push automatically after every local edit.

## Validation workflow

For page behavior, rendering, or data-driven UI changes, prefer this sequence:

1. `npm run check`
2. `npm run test:smoke`

For narrower script-only edits, at minimum run the relevant syntax check or
`npm run check`.

## Evaluating new data source or feature ideas

When the user proposes adding a new data source or feature, always run through
this checklist **before** recommending or implementing it:

1. **Is there a documented public API?**
   If no, flag it immediately. Undocumented or unofficial access counts as scraping.

2. **Does it require scraping unstable HTML or reverse-engineered endpoints?**
   If yes, it violates the project constraints. Reject it.

3. **Does it cover all (or most) 179 MPs?**
   If coverage is partial (e.g., only ministers or party leaders), explain the gap.
   A metric that only applies to 20 of 179 members is not suitable as a core feature.

4. **Is it from an official or highly reliable source?**
   Private media companies, aggregators, and third-party wrappers do not qualify.

5. **Is it objective and verifiable?**
   Approval ratings, sentiment scores, and editorial rankings conflict with the
   neutral, source-first presentation goal. Reject or flag as unsuitable.

6. **Does it require credentials, contracts, or application approval?**
   If access is gated, it cannot be part of the static-site pipeline.

7. **Document the outcome in IDEAS.md.**
   Add a section under "Evaluated and rejected ideas" (if rejected) with:
   - what was proposed
   - why it was rejected (mapped to which constraints it violates)
   - which sources/URLs were checked

Do this for every idea, even if the conclusion is positive.

## Key Files

- `FOLKEVALGET_DESIGN_LANGUAGE.md` — design system and mission (read before any UI work)
- `FOLKEVALGET_DATA_INVENTORY.md` — what data we have, what we don't, what's planned
- `IDEAS.md` — feature backlog
- `style.css` — all CSS variables and global styles
- `shared.js` — shared utilities and nav
- `profil.html` / `profile.js` — member profile page
- `discover.html` / `discover.js` — member browser
- `afstemninger.html` / `votes.js` — vote browser
- `data/profiler.json` — all 179 member profiles
- `data/afstemninger.json` — all votes
