import { describe, expect, it } from 'vitest'
import type { BudgetVsActual } from '@/types'
import {
  buildBudgetPaceSeries,
  normalizeBudgetForecast,
  normalizeBudgetComparisonRows,
  sortBudgetCategories,
  summarizeBudgetHistory,
  summarizeBudgetMonth,
  typicalActualForCategory,
  type BudgetVsActualApiRow,
  type CategoryForecast,
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
  it('measures the budget against budgeted categories and keeps other spending separate', () => {
    const result = summarizeBudgetMonth([
      row({ budget_amount: 200, actual_amount: 90, projected_amount: 120 }),
      row({ category_id: 'category-2', budget_amount: null, actual_amount: 10, projected_amount: 15 }),
    ], '2026-10', new Date(2026, 9, 3))

    expect(result).toMatchObject({
      budget: 200,
      hasBudget: true,
      actual: 100,
      budgetedActual: 90,
      unbudgeted: 10,
      remaining: 110,
      daysElapsed: 3,
      daysRemaining: 28,
      usedShare: 0.45,
      fixedUpcoming: 30,
      // The 30 still scheduled is set aside before splitting what is left over the days.
      safeDaily: (110 - 30) / 28,
      forecast: 120,
    })
    expect(result.paceDelta).toBeCloseTo(200 * 3 / 31 - 90)
  })

  it('takes the forecast per category from the expected map when given', () => {
    const result = summarizeBudgetMonth(
      [row({ budget_amount: 200, actual_amount: 90, projected_amount: 120 })],
      '2026-10',
      new Date(2026, 9, 3),
      new Map([['category-1', { expected: 180, fixedUpcoming: 50 }]]),
    )
    expect(result.forecast).toBe(180)
    expect(result.fixedUpcoming).toBe(50)
  })

  it('handles closed months and months without a budget', () => {
    const monthEnd = summarizeBudgetMonth([row({ budget_amount: 100, actual_amount: 120 })], '2026-10', new Date(2026, 9, 31))
    expect(monthEnd.daysRemaining).toBe(0)
    expect(monthEnd.safeDaily).toBe(0)
    expect(monthEnd.remaining).toBe(-20)

    const noBudget = summarizeBudgetMonth([row({ budget_amount: null, actual_amount: 25, projected_amount: 30 })], '2026-10', new Date(2026, 9, 3))
    expect(noBudget).toMatchObject({ budget: 0, hasBudget: false, hasActivity: true, safeDaily: 0, unbudgeted: 25, forecast: 30, paceDelta: 0 })

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

describe('typicalActualForCategory', () => {
  it('takes the median month so one large purchase does not set the suggestion', () => {
    expect(typicalActualForCategory([
      [row({ category_id: 'care', actual_amount: 45 })],
      [row({ category_id: 'care', actual_amount: 1400 })],
      [row({ category_id: 'care', actual_amount: 60 })],
    ], 'care')).toBe(60)
    expect(typicalActualForCategory([[], [], [row({ category_id: 'care', actual_amount: 60 })]], 'care')).toBe(0)
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

describe('normalizeBudgetForecast', () => {
  it('turns decimal strings into numbers and day lists into 1-based arrays', () => {
    const forecast = normalizeBudgetForecast({
      month: '2026-10-01',
      days_in_month: 3,
      days_elapsed: 1,
      learned_months: 3,
      categories: [{
        category_id: 'rent',
        expected: '950.00',
        fixed_upcoming: '950.00',
        daily_actual: ['0.00', '0.00', '0.00'],
        daily_upcoming: ['0.00', '950.00', '0.00'],
        from_history: true,
      }],
    })

    expect(forecast.learnedMonths).toBe(3)
    expect(forecast.categories.get('rent')).toEqual({
      expected: 950,
      fixedUpcoming: 950,
      dailyActual: [0, 0, 0, 0],
      upcoming: [0, 0, 950, 0],
      fromHistory: true,
    })
  })
})

describe('buildBudgetPaceSeries', () => {
  function forecast(overrides: Partial<CategoryForecast>): CategoryForecast {
    return { expected: 0, fixedUpcoming: 0, dailyActual: new Array(32).fill(0), upcoming: new Array(32).fill(0), fromHistory: false, ...overrides }
  }
  const dailyActual = new Array<number>(32).fill(0)
  dailyActual[1] = 10
  dailyActual[3] = 5
  const upcoming = new Array<number>(32).fill(0)
  upcoming[5] = 20
  const food = forecast({ expected: 35, dailyActual, upcoming })
  const other = forecast({ dailyActual: dailyActual.map((value) => value * 50), upcoming: upcoming.map((value) => value * 50) })

  it('anchors the lines to the budget figures and only counts the given categories', () => {
    const series = buildBudgetPaceSeries('2026-10', {
      categoryIds: new Set(['food']),
      actualTotal: 15,
      forecasts: new Map([['food', food], ['other', other]]),
    }, new Date(2026, 9, 3))

    expect(series).toHaveLength(31)
    expect(series[0]).toMatchObject({ day: 1, actual: 10, forecast: null })
    expect(series[2]).toMatchObject({ day: 3, actual: 15, forecast: 15 })
    expect(series[3]).toMatchObject({ day: 4, actual: null, forecast: 15 })
    expect(series[30].forecast).toBe(35)
  })

  it('rescales when the daily figures miss adjustments such as splits', () => {
    const series = buildBudgetPaceSeries('2026-10', {
      categoryIds: new Set(['food']), actualTotal: 30, forecasts: new Map([['food', forecast({ dailyActual })]]),
    }, new Date(2026, 9, 3))

    expect(series[0].actual).toBe(20)
    expect(series[2].actual).toBe(30)
    expect(series[30].forecast).toBe(30)
  })

  it('draws no forecast for a closed month and only a forecast for a future month', () => {
    const past = buildBudgetPaceSeries('2026-10', {
      categoryIds: new Set(['food']), actualTotal: 15, forecasts: new Map([['food', food]]),
    }, new Date(2026, 10, 2))
    expect(past.every((point) => point.forecast === null)).toBe(true)
    expect(past[30].actual).toBe(15)

    const future = buildBudgetPaceSeries('2026-10', {
      categoryIds: new Set(['food']), actualTotal: 0, forecasts: new Map([['food', forecast({ upcoming })]]),
    }, new Date(2026, 8, 20))
    expect(future.every((point) => point.actual === null)).toBe(true)
    expect(future[3].forecast).toBe(0)
    expect(future[4].forecast).toBe(20)
  })
})

describe('sortBudgetCategories', () => {
  it('puts over-budget, near-limit and expected-over categories first', () => {
    const sorted = sortBudgetCategories([
      row({ category_id: 'no-budget', budget_amount: null, actual_amount: 50 }),
      row({ category_id: 'on-track', budget_amount: 100, actual_amount: 20 }),
      row({ category_id: 'expected-over', budget_amount: 100, actual_amount: 10 }),
      row({ category_id: 'near-limit', budget_amount: 100, actual_amount: 85 }),
      row({ category_id: 'over-budget', budget_amount: 100, actual_amount: 110 }),
    ], new Map([['expected-over', 140]]))

    expect(sorted.map((item) => item.category_id)).toEqual(['over-budget', 'near-limit', 'expected-over', 'on-track', 'no-budget'])
  })
})
