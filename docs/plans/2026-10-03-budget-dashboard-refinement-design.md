# Budget Dashboard Refinement Design

**Status:** Approved by the user on 2026-10-03  
**Branch:** `feature/budget-dashboard`

## Goal

Improve both the visual hierarchy and the consistency of financial explanations on Securo's budget overview, while keeping the existing Securo design system, personal live data, and working budget workflows.

## Current findings

- The top summary and the monthly pace panel both communicate projections, but the current labels can make their different calculations look contradictory.
- The backend `BudgetVsActual.projected_amount` is posted actual spending plus future recurring projections and pending/future forecast transactions. It is a transaction-based projection, not a daily run-rate estimate.
- The frontend's `expectedAtPace` is a linear run-rate estimate based on actual spending so far and elapsed calendar days.
- The main page repeats pace status in multiple places, making the visual hierarchy less clear.
- A month with no budget should guide budget setup while retaining any actual spending information for that month.

## Approved direction

Use one clear monthly summary as the visual anchor: total budget, spending to date, remaining amount, and budget usage. Present secondary measures with distinct names and supporting copy:

- **Transaction forecast:** `projected_amount`, explicitly described as actual spending plus scheduled, recurring, and forecast transactions available to Securo.
- **Current-pace estimate:** `expectedAtPace`, described as a straight-line estimate based on spending so far.
- **Safe to spend per day:** remaining budget divided by remaining days, shown only where a positive budget and remaining days make it meaningful.

The chart will keep actual spending, future planned transactions, and the budget limit visually distinct. Its scale and tick labels must remain readable for small, large, and zero values. Remove duplicated pace messaging where the summary, chart, and pace card already convey the same fact.

For a month with no budget, show a prominent action to set one for that selected month. Preserve actual spending if present, but omit budget percentages and per-day safe-spend values that have no meaningful denominator. If there is neither budget nor spending, replace empty chart chrome with a concise empty state.

Keep month selection, category-to-transactions navigation, budget setup and average suggestions, privacy masking, localization, and the existing API contract. No backend changes or changes to the user's financial data are part of this design.

## Interaction and accessibility

- Preserve month context when navigating between overview and settings.
- Keep category rows keyboard reachable and send clicks to transactions filtered by category and selected month.
- Maintain clear focus states, responsive layout, localized labels, and masked-value behavior.
- For empty months, link the setup action to the currently selected month.

## Data and failure handling

- Keep decimal-string normalization at the API boundary before reducers or chart calculations.
- Use the backend comparison as the source for transaction forecasts and the calendar endpoint for day-by-day chart placement; check that their totals reconcile for the selected month during implementation.
- On API failure, show a recoverable error with retry and keep optional history failures scoped to the history section.
- Treat a missing/zero budget as an explicit state; avoid `NaN`, infinity, and arbitrary micro-currency chart axes.

## Validation

- Verify both visual hierarchy and displayed semantics in the logged-in local preview using the user's Securo data without changing it.
- Check a budgeted month, a month with no budget, and a category-to-transactions route.
- Cover projection semantics, month boundaries, no-budget states, and chart scale edge cases with focused frontend tests.
- Run the frontend test suite, lint, production build, and `git diff --check`.

## Out of scope

- Backend endpoint or schema changes unless implementation discovers the existing contract cannot support the approved behavior.
- Changing or seeding production financial data.
- Redesigning other Securo pages or changing unrelated components.
