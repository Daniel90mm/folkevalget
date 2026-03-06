# Repository Instructions

- Read `C:\Users\danie\Desktop\Mig\Programmering\Git\folkevalget\FOLKEVALGET_DESIGN_LANGUAGE.md` at the start of each task involving design or feature work, and use it to validate that all changes uphold the project's design and product rules.
- Keep the interface focused and avoid clutter. Prefer fewer, clearer elements over adding more UI chrome, labels, badges, or decorative containers.
- Follow the existing design rules and visual language already established in the repo. Extend current patterns instead of inventing a competing style.
- Do not use pill-shaped UI treatments. Avoid pill buttons, pill tabs, pill filters, and fully rounded badge/chip patterns unless the user explicitly asks for them.
- Interpret requests like `remove the box border`, `remove boxes`, `anti-boxification`, and `no-boxification` as a shared flattening pattern:
  remove the outer border, remove any tinted or lighter panel/card background, and let the section sit directly on the page background.
- When flattening a section, keep only the minimum structure needed for readability:
  preserve spacing, typography hierarchy, row separators, table dividers, and party-color rails only where they help scanning; do not leave decorative containers behind.
- Do not stop at deleting a single `border` rule if the element still reads as a boxed surface because of `background: var(--color-surface)`, inset panel wrappers, or duplicated inner separators.

## Local commands to prefer

- Use `pwsh` instead of legacy Windows PowerShell when running local commands.
- Start the local site with `npm run dev`.
- Run quick validation with `npm run check`.
- Run browser smoke tests with `npm run test:smoke`.
- Refresh data incrementally with `npm run refresh:data`.
- Use `npm run refresh:data:full` only when a full rebuild from `2022-11-01` is actually needed.

## Validation and push workflow

- For page behavior, rendering, or data-driven UI changes, prefer this validation sequence:
  1. `npm run check`
  2. `npm run test:smoke`
- For smaller single-script edits, at minimum run the relevant syntax check or `npm run check`.
- Do not push automatically after every change.
- Push when the user explicitly asks for it, or when the task itself explicitly requires a push.

## Evaluating new data source or feature ideas

When a new data source or feature is proposed, run through this checklist before recommending or implementing it:

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
