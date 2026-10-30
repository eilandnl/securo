import type { BudgetVsActual } from '@/types'
import { monthLastDay } from '@/lib/month-utils'

type DecimalAmount = number | string

export type BudgetVsActualApiRow = Omit<
  BudgetVsActual,
  | 'budget_amount'
  | 'actual_amount'
  | 'projected_amount'
  | 'prev_month_amount'
  | 'projected_prev_month_amount'
  | 'percentage_used'
> & {
  budget_amount: DecimalAmount | null
  actual_amount: DecimalAmount
  projected_amount: DecimalAmount
  prev_month_amount: DecimalAmount
  projected_prev_month_amount: DecimalAmount
  percentage_used: DecimalAmount | null
}

export function normalizeBudgetComparisonRows(rows: BudgetVsActualApiRow[]): BudgetVsActual[] {
  return rows.map((row) => ({
    ...row,
    budget_amount: row.budget_amount === null ? null : Number(row.budget_amount),
    actual_amount: Number(row.actual_amount),
    projected_amount: Number(row.projected_amount),
    prev_month_amount: Number(row.prev_month_amount),
    projected_prev_month_amount: Number(row.projected_prev_month_amount),
    percentage_used: row.percentage_used === null ? null : Number(row.percentage_used),
  }))
}

export function hasCategoryBudget(row: BudgetVsActual): boolean {
  return row.budget_amount !== null && row.budget_amount > 0
}

export interface BudgetOverviewTotals {
  budget: number
  hasBudget: boolean
  /** All categorized spending, budgeted or not. */
  actual: number
  /** Spending in categories that have a budget; what the budget is measured against. */
  budgetedActual: number
  hasActivity: boolean
  remaining: number
  unbudgeted: number
  monthDays: number
  daysElapsed: number
  daysRemaining: number
  /** Share of the budget used so far (0 without a budget). */
  usedShare: number
  /** Fixed charges (scheduled or recurring) still to come in the budgeted categories. */
  fixedUpcoming: number
  /** What is left per remaining day once the fixed charges still to come are paid. */
  safeDaily: number
  /** Expected month-end spending for the budgeted categories (all categories without a budget). */
  forecast: number
  /** Positive when spending is behind an even spread of the budget over the month. */
  paceDelta: number
}

export function elapsedDaysInMonth(month: string, now: Date): number {
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  if (month < currentMonth) return monthLastDay(month)
  if (month > currentMonth) return 0
  return now.getDate()
}

/**
 * Month totals. `forecasts` comes from `forecastCategories`; categories
 * missing from it fall back to the comparison's own projection (posted
 * spending plus scheduled transactions).
 */
export function summarizeBudgetMonth(
  rows: BudgetVsActual[],
  month: string,
  now = new Date(),
  forecasts?: ReadonlyMap<string, Pick<CategoryForecast, 'expected' | 'fixedUpcoming'>>,
): BudgetOverviewTotals {
  const budgeted = rows.filter(hasCategoryBudget)
  const budget = budgeted.reduce((sum, row) => sum + row.budget_amount!, 0)
  const hasBudget = budget > 0
  const scope = hasBudget ? budgeted : rows
  const actual = rows.reduce((sum, row) => sum + row.actual_amount, 0)
  const budgetedActual = budgeted.reduce((sum, row) => sum + row.actual_amount, 0)
  const forecast = scope.reduce((sum, row) => sum + (forecasts?.get(row.category_id)?.expected ?? row.projected_amount), 0)
  const fixedUpcoming = budgeted.reduce(
    (sum, row) => sum + (forecasts?.get(row.category_id)?.fixedUpcoming ?? Math.max(0, row.projected_amount - row.actual_amount)),
    0,
  )

  const monthDays = monthLastDay(month)
  const daysElapsed = elapsedDaysInMonth(month, now)
  const daysRemaining = Math.max(0, monthDays - daysElapsed)
  const remaining = budget - budgetedActual

  return {
    budget,
    hasBudget,
    actual,
    budgetedActual,
    hasActivity: rows.some((row) => row.actual_amount !== 0 || row.projected_amount !== 0),
    remaining,
    unbudgeted: actual - budgetedActual,
    monthDays,
    daysElapsed,
    daysRemaining,
    usedShare: hasBudget ? budgetedActual / budget : 0,
    fixedUpcoming,
    safeDaily: daysRemaining > 0 ? Math.max(0, (remaining - fixedUpcoming) / daysRemaining) : 0,
    forecast,
    paceDelta: hasBudget ? budget * (daysElapsed / monthDays) - budgetedActual : 0,
  }
}

/**
 * A category's typical month: the median spending over `months` (a month
 * without activity counts as zero), so one large purchase does not set it.
 */
export function typicalActualForCategory(months: BudgetVsActual[][], categoryId: string): number {
  if (months.length === 0) return 0
  return median(months.map((rows) => rows.find((row) => row.category_id === categoryId)?.actual_amount ?? 0))
}

export function summarizeBudgetHistory(months: Array<{ budget: number; actual: number }>) {
  const budgetedMonths = months.filter((month) => month.budget > 0)
  return {
    underBudgetMonths: budgetedMonths.filter((month) => month.actual <= month.budget).length,
    budgetedMonths: budgetedMonths.length,
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** One category's month-end forecast, computed by `GET /budgets/forecast`. */
export interface CategoryForecast {
  /** Expected month-end spending. */
  expected: number
  /** Fixed charges still to come: scheduled transactions or unpaid recurring charges. */
  fixedUpcoming: number
  /** Net spending so far, per day of month (index 1..days). */
  dailyActual: number[]
  /** Expected spending still to come, per day of month (index 1..days). */
  upcoming: number[]
  /** Whether part of the forecast was learned from earlier months. */
  fromHistory: boolean
}

export interface BudgetForecastApi {
  month: string
  days_in_month: number
  days_elapsed: number
  learned_months: number
  categories: Array<{
    category_id: string
    expected: DecimalAmount
    fixed_upcoming: DecimalAmount
    daily_actual: DecimalAmount[]
    daily_upcoming: DecimalAmount[]
    from_history: boolean
  }>
}

export interface BudgetForecastData {
  learnedMonths: number
  categories: Map<string, CategoryForecast>
}

/** Decimal strings to numbers, and day lists to 1-based arrays so a day is its own index. */
export function normalizeBudgetForecast(forecast: BudgetForecastApi): BudgetForecastData {
  const byDay = (values: DecimalAmount[]) => [0, ...values.map(Number)]
  return {
    learnedMonths: forecast.learned_months,
    categories: new Map(forecast.categories.map((category) => [category.category_id, {
      expected: Number(category.expected),
      fixedUpcoming: Number(category.fixed_upcoming),
      dailyActual: byDay(category.daily_actual),
      upcoming: byDay(category.daily_upcoming),
      fromHistory: category.from_history,
    }])),
  }
}

export interface BudgetPacePoint {
  day: number
  actual: number | null
  forecast: number | null
}

/**
 * Daily cumulative spending for the budget chart.
 *
 * The daily spending only supplies the *shape* of the line; it is anchored
 * to the budget comparison so it ends exactly on the spent figure shown next
 * to it (split adjustments are not in the daily figures). The forecast
 * continues from today with the per-category `upcoming` amounts, so it ends
 * on the forecast figure.
 */
export function buildBudgetPaceSeries(
  month: string,
  {
    categoryIds,
    actualTotal,
    forecasts,
  }: {
    categoryIds: ReadonlySet<string>
    actualTotal: number
    forecasts: ReadonlyMap<string, CategoryForecast>
  },
  today = new Date(),
): BudgetPacePoint[] {
  const days = monthLastDay(month)
  const elapsed = elapsedDaysInMonth(month, today)
  const actualByDay = new Array<number>(days + 1).fill(0)
  const upcomingByDay = new Array<number>(days + 1).fill(0)
  for (const [categoryId, forecast] of forecasts) {
    if (!categoryIds.has(categoryId)) continue
    forecast.dailyActual.forEach((amount, day) => { actualByDay[day] += amount })
    forecast.upcoming.forEach((amount, day) => { upcomingByDay[day] += amount })
  }

  const actualSeries = anchoredCumulative(actualByDay, elapsed, actualTotal)
  const forecastStart = elapsed > 0 ? actualTotal : 0
  let upcoming = 0

  return Array.from({ length: days }, (_, index) => {
    const day = index + 1
    if (day > elapsed) upcoming += upcomingByDay[day]
    // The forecast line starts on today's point so the two lines connect.
    const showForecast = elapsed < days && day >= Math.max(1, elapsed)
    return {
      day,
      actual: day <= elapsed ? actualSeries[day] : null,
      forecast: showForecast ? forecastStart + upcoming : null,
    }
  })
}

/**
 * Cumulative sums of `daily[1..to]`, rescaled so the last value equals
 * `total`. Spreads evenly when the daily data has no usable shape (e.g. the
 * total comes only from split adjustments).
 */
function anchoredCumulative(daily: number[], to: number, total: number): number[] {
  const result = new Array<number>(daily.length).fill(0)
  let raw = 0
  const cumulative: number[] = []
  for (let day = 1; day <= to; day += 1) {
    raw = Math.max(0, raw + daily[day])
    cumulative[day] = raw
  }
  for (let day = 1; day <= to; day += 1) {
    result[day] = raw > 0 ? (cumulative[day] / raw) * total : (total * day) / to
  }
  return result
}

/**
 * Over budget first, then categories near their limit or expected to go over,
 * then the rest by share used; categories without a budget last.
 */
export function sortBudgetCategories(
  rows: BudgetVsActual[],
  expected?: ReadonlyMap<string, number>,
): BudgetVsActual[] {
  const band = (row: BudgetVsActual) => {
    if (!hasCategoryBudget(row)) return 3
    const used = row.actual_amount / row.budget_amount!
    if (used > 1) return 0
    if (used >= 0.8 || (expected?.get(row.category_id) ?? 0) > row.budget_amount!) return 1
    return 2
  }
  const used = (row: BudgetVsActual) => hasCategoryBudget(row) ? row.actual_amount / row.budget_amount! : -1
  return [...rows].sort((left, right) =>
    band(left) - band(right) || used(right) - used(left) || right.actual_amount - left.actual_amount)
}
