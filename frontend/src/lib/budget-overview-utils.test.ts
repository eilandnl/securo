import { describe, expect, it } from 'vitest'
import type { BudgetVsActual, TransactionCalendarResponse } from '@/types'
import {
  averageActualForCategory,
  buildBudgetPaceSeries,
  normalizeBudgetComparisonRows,
  sortBudgetCategories,
  summarizeBudgetHistory,
  summarizeBudgetMonth,
  type BudgetVsActualApiRow,
} from '@/lib/budget-overview-utils'

function row(overrides: Partial<BudgetVsActual> = {}): BudgetVsActual {
  return {
    category_id: 'category-1',
    category_name: 'Category',
    category_icon: 'shopping-cart',
    category_color: '#000000',
    group_id: null,
    group_name: null,
    budget_amount: 100,
    actual_amount: 0,
    projected_amount: 0,
    prev_month_amount: 0,
    projected_prev_month_amount: 0,
    percentage_used: 0,
    is_recurring: false,
    ...overrides,
  }
}

describe('summarizeBudgetMonth', () => {
  it('derives totals, pace and safe daily spend from budget comparison data', () => {
    const result = summarizeBudgetMonth([
      row({ budget_amount: 200, actual_amount: 90, projected_amount: 120 }),
      row({ category_id: 'category-2', budget_amount: null, actual_amount: 10, projected_amount: 15 }),
    ], '2026-10', new Date(2026, 9, 3))

    expect(result).toMatchObject({
      budget: 200,
      hasBudget: true,
      actual: 100,
      projected: 135,
      hasActivity: true,
      unbudgeted: 10,
      remaining: 100,
      daysElapsed: 3,
      daysRemaining: 28,
      safeDaily: 100 / 28,
      expectedAtPace: (100 / 3) * 31,
    })
    expect(result.paceDelta).toBeCloseTo(200 * 3 / 31 - 100)
  })

  it('returns zero safe daily spend after month end and handles months without a budget', () => {
    const monthEnd = summarizeBudgetMonth([row({ budget_amount: 100, actual_amount: 120 })], '2026-10', new Date(2026, 9, 31))
    expect(monthEnd.daysRemaining).toBe(0)
    expect(monthEnd.safeDaily).toBe(0)
    expect(monthEnd.remaining).toBe(-20)

    const noBudget = summarizeBudgetMonth([row({ budget_amount: null, actual_amount: 25 })], '2026-10', new Date(2026, 9, 3))
    expect(noBudget.budget).toBe(0)
    expect(noBudget.hasBudget).toBe(false)
    expect(noBudget.hasActivity).toBe(true)
    expect(noBudget.safeDaily).toBe(0)
    expect(noBudget.unbudgeted).toBe(25)

    const empty = summarizeBudgetMonth([], '2026-10', new Date(2026, 9, 3))
    expect(empty.hasBudget).toBe(false)
    expect(empty.hasActivity).toBe(false)
  })

  it('counts zero-limit categories as unbudgeted spending', () => {
    const result = summarizeBudgetMonth([
      row({ category_id: 'zero-budget', budget_amount: 0, actual_amount: 12 }),
      row({ category_id: 'no-budget', budget_amount: null, actual_amount: 8 }),
    ], '2026-10', new Date(2026, 9, 3))

    expect(result.unbudgeted).toBe(20)
  })
})

describe('normalizeBudgetComparisonRows', () => {
  it('converts decimal strings from the API to numbers and preserves nullable values', () => {
    const raw = {
      ...row(),
      budget_amount: '125.50',
      actual_amount: '42.75',
      projected_amount: '60.25',
      prev_month_amount: '20.00',
      projected_prev_month_amount: '24.00',
      percentage_used: '34.06',
    } as unknown as BudgetVsActualApiRow

    expect(normalizeBudgetComparisonRows([raw])[0]).toMatchObject({
      budget_amount: 125.5,
      actual_amount: 42.75,
      projected_amount: 60.25,
      prev_month_amount: 20,
      projected_prev_month_amount: 24,
      percentage_used: 34.06,
    })

    const withoutBudget = { ...raw, budget_amount: null, percentage_used: null }
    expect(normalizeBudgetComparisonRows([withoutBudget])[0]).toMatchObject({
      budget_amount: null,
      percentage_used: null,
    })
  })
})

describe('averageActualForCategory', () => {
  it('averages a category across all requested months, including months with no activity', () => {
    const result = averageActualForCategory([
      [row({ category_id: 'food', actual_amount: 60 })],
      [],
      [row({ category_id: 'food', actual_amount: 60 })],
    ], 'food')

    expect(result).toBe(40)
  })
})

describe('summarizeBudgetHistory', () => {
  it('excludes months without budgets from the under-budget denominator', () => {
    expect(summarizeBudgetHistory([
      { budget: 0, actual: 25 },
      { budget: 100, actual: 80 },
      { budget: 50, actual: 55 },
    ])).toEqual({ underBudgetMonths: 1, budgetedMonths: 2 })
  })
})

describe('buildBudgetPaceSeries', () => {
  it('builds cumulative actual and planned expense points for the selected month', () => {
    const calendar: TransactionCalendarResponse = {
      month: '2026-10-01',
      currency: 'EUR',
      account_ids: null,
      days: [
        { date: '2026-10-01', in_month: true, ending_balance: 0, income: 0, expense: 10, transfer_net: 0, actual_income: 0, actual_expense: 10, actual_transfer_net: 0, projected_income: 0, projected_expense: 0, projected_transfer_net: 0, actual_count: 1, projected_count: 0, has_income: false, has_expense: true, has_transfer: false, items: [] },
        { date: '2026-10-03', in_month: true, ending_balance: 0, income: 0, expense: 5, transfer_net: 0, actual_income: 0, actual_expense: 5, actual_transfer_net: 0, projected_income: 0, projected_expense: 0, projected_transfer_net: 0, actual_count: 1, projected_count: 0, has_income: false, has_expense: true, has_transfer: false, items: [] },
        { date: '2026-10-05', in_month: true, ending_balance: 0, income: 0, expense: 0, transfer_net: 0, actual_income: 0, actual_expense: 0, actual_transfer_net: 0, projected_income: 0, projected_expense: 8, projected_transfer_net: 0, actual_count: 0, projected_count: 1, has_income: false, has_expense: true, has_transfer: false, items: [] },
      ],
    }
    const series = buildBudgetPaceSeries(calendar, '2026-10', 200, 130, new Date(2026, 9, 3))

    expect(series).toHaveLength(31)
    expect(series[0]).toMatchObject({ day: 1, actual: 10, planned: null, budget: 200 })
    expect(series[2]).toMatchObject({ day: 3, actual: 15, planned: null })
    expect(series[4]).toMatchObject({ day: 5, actual: null, planned: 23 })
    expect(series[30].monthEstimate).toBe(130)
  })
})

describe('sortBudgetCategories', () => {
  it('puts over-budget and near-limit categories before categories without budgets', () => {
    const sorted = sortBudgetCategories([
      row({ category_id: 'no-budget', budget_amount: null, actual_amount: 50 }),
      row({ category_id: 'on-track', budget_amount: 100, actual_amount: 20 }),
      row({ category_id: 'near-limit', budget_amount: 100, actual_amount: 85 }),
      row({ category_id: 'over-budget', budget_amount: 100, actual_amount: 110 }),
    ])

    expect(sorted.map((item) => item.category_id)).toEqual(['over-budget', 'near-limit', 'on-track', 'no-budget'])
  })
})
