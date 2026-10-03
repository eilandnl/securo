# Budget dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Talvo-inspired monthly budget dashboard in Securo and move the current budget editor to Budget settings.

**Architecture:** Add a new overview route and page, using existing budget-comparison and transaction calendar APIs for actual/projection summaries. Retain `/budgets` for the current CRUD settings page. Update shared navigation and localized labels; keep calculations client-side and derived.

**Tech Stack:** React, TypeScript, React Router, TanStack Query, Recharts, Tailwind CSS, i18next, existing Securo API clients.

---

### Task 1: Separate budget overview and settings navigation

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/lib/nav-items.ts`
- Modify: `frontend/src/components/command-palette.tsx`
- Modify: `frontend/src/locales/*.json`
- Modify: `frontend/src/pages/budgets.tsx`

**Steps:**
1. Add a lazy route for `/budget` and a new budget overview page placeholder.
2. Keep `/budgets` mapped to current CRUD page and label it Budget settings.
3. Put Budget under analysis and Budget settings under setup, with localized labels in every locale.
4. Update command-palette entry so overview and settings remain discoverable.
5. Add an overview link from settings and settings action from overview.

### Task 2: Build monthly summary and pacing view

**Files:**
- Create: `frontend/src/pages/budget-overview.tsx`
- Create: `frontend/src/lib/budget-overview-utils.ts`
- Modify: `frontend/src/lib/api.ts` only if existing APIs need a typed wrapper adjustment
- Modify: `frontend/src/locales/*.json`

**Steps:**
1. Add month state, previous/next controls and the shared month picker.
2. Query `budgets.comparison(month)` and `transactions.calendar({ month })` through TanStack Query.
3. Derive total budget, actual expenses, budget remaining, elapsed-month pace, projected month end and safe daily allowance with empty, over-budget and month-end handling.
4. Render a Securo-styled summary card and cumulative month chart with accessible labels/tooltips.
5. Respect display currency, locale, theme and privacy masking.

### Task 3: Add category detail, attention and history

**Files:**
- Modify: `frontend/src/pages/budget-overview.tsx`
- Modify: `frontend/src/lib/budget-overview-utils.ts`
- Modify: `frontend/src/locales/*.json`

**Steps:**
1. Render category spending versus limit, remaining amount and progress bars; visually flag over-limit and near-limit categories.
2. Add income/expense filtering only if comparison data supports both without a second incompatible calculation; otherwise keep expense overview coherent and leave income budgets visible in settings.
3. Fetch a bounded set of preceding monthly comparisons and summarize under-budget history without unbounded requests.
4. Add clear empty states and link unbudgeted categories to Budget settings.

### Task 4: Polish navigation and responsive layout

**Files:**
- Modify: `frontend/src/pages/budget-overview.tsx`
- Modify: `frontend/src/pages/budgets.tsx`
- Modify: `frontend/src/locales/*.json`

**Steps:**
1. Verify loading, empty, no-budget, month-end, and no-history visual states by code review.
2. Ensure mobile layout stacks cards and preserves usable month navigation and category progress.
3. Review final diff for unrelated changes. Do not add or run tests unless user asks for verification.
