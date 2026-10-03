# Securo Budget Dashboard Refinement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refine the Securo budget overview so the monthly status has a calmer visual hierarchy and the transaction forecast, current-pace estimate, and no-budget state are explained consistently.

**Architecture:** Keep the existing frontend API and comparison/calendar data flow. Clarify the UI around the contract that `projected_amount` is posted actual spending plus recurring and forecast transactions, while `expectedAtPace` is a linear extrapolation from actual spending. Keep overview-specific presentation in `budget-overview.tsx`, pure calculations and invariants in `budget-overview-utils.ts`, and translated copy in all existing locale files.

**Tech Stack:** React, TypeScript, TanStack Query, Recharts, Tailwind, react-i18next, Vitest, ESLint, Vite.

---

### Task 1: Lock down projection and no-budget semantics

**Files:**
- Modify: `frontend/src/lib/budget-overview-utils.test.ts`
- Modify only if needed: `frontend/src/lib/budget-overview-utils.ts`

**Step 1: Add failing tests for explicit month state and projection meanings**

Use a fixed date in a month with a budget and one row whose `actual_amount` and `projected_amount` differ. Assert `projected` keeps the backend transaction-forecast total and `expectedAtPace` is the actual amount divided by elapsed days and multiplied by month length. Also assert the summary explicitly reports whether a positive budget exists and whether actual or projected activity exists.

**Step 2: Run the focused test and verify it fails for the missing assertion/behavior**

Run from `frontend/`:

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lib/budget-overview-utils.test.ts
```

Expected: the new month-state assertions fail before any implementation change.

**Step 3: Add a failing no-budget-with-spending test**

Assert a row with no positive budget preserves actual and projected amounts, reports `hasBudget: false` and `hasActivity: true`, keeps `safeDaily` at zero, and yields no non-finite values. Assert the all-empty state reports `hasActivity: false`.

**Step 4: Run the focused test again**

Run the same command. Expected: the missing explicit state flags fail the focused test before implementation.

**Step 5: Make the smallest helper change if a new regression is exposed**

Return `hasBudget` and `hasActivity` from the existing utility alongside the current amounts. Keep projection arithmetic unchanged. Do not add prediction formulas or change backend data semantics.

**Step 6: Run the focused test file**

Run the same command. Expected: all budget overview utility tests pass.

**Step 7: Commit the utility contract**

```bash
git add frontend/src/lib/budget-overview-utils.ts frontend/src/lib/budget-overview-utils.test.ts
git commit -m "test: clarify budget forecast semantics"
```

### Task 2: Simplify the monthly summary hierarchy

**Files:**
- Modify: `frontend/src/pages/budget-overview.tsx`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/nl.json`
- Modify: the same forecast/empty-state keys in the other 13 existing locale files

**Step 1: Add translated labels and explanatory copy**

Add localized text that distinctly names the transaction-based month-end forecast and the current-spending-pace estimate. Ensure copy for the transaction forecast mentions posted plus planned/recurring transactions without promising transactions Securo does not have. Preserve the current locale key naming conventions.

**Step 2: Run locale parsing and focused lint checks**

Run from `frontend/`:

```bash
node -e 'const fs=require("node:fs"); for (const f of fs.readdirSync("src/locales").filter((name) => name.endsWith(".json"))) JSON.parse(fs.readFileSync("src/locales/" + f, "utf8"))'
npx eslint src/pages/budget-overview.tsx
```

Expected: every locale parses and the page has no lint errors or warnings.

**Step 3: Replace the repeated top metrics with one responsive monthly summary**

Present total budget, spending to date, and remaining together with one usage bar and one pace status. Keep the remaining amount visually prominent. Remove the duplicate pace status from the chart header.

**Step 4: Clarify the forecast panel**

Show the linear current-pace estimate and the transaction-based forecast as separate values with the new labels and supporting copy. Keep safe-per-day in the monthly summary only when the selected month has a positive budget and remaining days.

**Step 5: Implement the no-budget display rules**

Keep the selected-month setup CTA. Preserve actual and forecast totals if activity exists, but omit budget usage percentages and safe-per-day values without a positive budget. When budget, actuals, and forecast are all empty, show a compact empty state instead of an empty chart with a misleading tiny currency axis.

**Step 6: Re-run focused tests, locale parsing, and lint**

Run:

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lib/budget-overview-utils.test.ts src/lib/nav-items.test.ts
node -e 'const fs=require("node:fs"); for (const f of fs.readdirSync("src/locales").filter((name) => name.endsWith(".json"))) JSON.parse(fs.readFileSync("src/locales/" + f, "utf8"))'
npx eslint src/pages/budget-overview.tsx
```

Expected: tests pass, all locale JSON is valid, and lint is clean.

**Step 7: Commit the presentation refinement**

```bash
git add frontend/src/pages/budget-overview.tsx frontend/src/locales
git commit -m "feat: clarify budget overview forecasts"
```

### Task 3: Verify the experience against Securo data

**Files:**
- No additional files unless QA exposes a scoped issue.

**Step 1: Run the full frontend test suite**

Run from `frontend/`:

```bash
NODE_OPTIONS=--no-experimental-webstorage npm test -- --run
```

Expected: all frontend tests pass.

**Step 2: Run lint and production build**

Run:

```bash
npm run lint
npm run build
```

Expected: lint is clean and the build completes, including TypeScript typecheck.

**Step 3: Review the logged-in preview**

Use the already-running local Vite preview at `http://127.0.0.1:5173` and its existing Securo session. Inspect a budgeted month and a month with no budget. Confirm numbers are finite, projection labels distinguish the calculations, and the chart does not clip values.

**Step 4: Check the category-to-transactions flow and settings navigation**

Open a category from the overview and verify the transaction view receives the selected category and month. Confirm the overview/settings navigation marks only the selected route.

**Step 5: Review repository state**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only approved budget-dashboard changes remain.
