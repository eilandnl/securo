# Budget dashboard design

## Goal

Give Securo a useful monthly budget overview inspired by Talvo, while preserving the current budget-limit editor as a separate Budget settings page.

## User experience

- Add a dedicated **Budget** destination with month navigation.
- Show monthly spending, total budget, remaining amount, and how spending compares with the elapsed month.
- Show an end-of-month estimate and a safe daily spending amount, with clear copy when spending is already over budget or no budget exists.
- Show category-level actual spending against each category limit with readable progress and attention states.
- Show recent month history to make trends visible.
- Move the existing add/edit/delete budget-limit experience to **Budget settings**; keep its month selection and recurring behavior.
- Keep layout, colors, icons, spacing, responsive behavior, translations, and privacy masking consistent with Securo.

## Data and calculations

Use Securo's existing budget comparison and transaction/calendar APIs. The comparison response already includes actual, projected and previous-month amounts. Use actual spending for remaining budget and the safe daily amount; use the API projection fields for the forecast rather than persisting derived values. Use monthly totals and category comparisons for history. Avoid adding backend storage or new API contracts.

Forecast and safe-daily calculations must handle a zero budget, a fully elapsed month, negative remaining budget, and months with no spend. Exclude semantics already excluded by the existing comparison endpoint (transfers/ignored rows) rather than re-counting transactions independently.

## Navigation and compatibility

Add `/budget` for overview and retain `/budgets` for settings. Put the overview in the analysis navigation group and settings under setup. Update route labels and command-palette entries. Keep old `/budgets` links valid as the settings page.

## Visual direction

Use Talvo's information hierarchy: prominent month summary, spending pace/projection, category progress, attention states and history. Use Securo's existing cards, typography, semantic colors, category icons, month picker, charts, privacy mode and localization patterns. Do not copy Talvo branding or colors.

## Boundaries

Frontend-only work. No new backend fields, schema changes, migrations, budget automation, or changes to transaction categorization. Maintain workspace permissions and the existing write guard on settings actions.
