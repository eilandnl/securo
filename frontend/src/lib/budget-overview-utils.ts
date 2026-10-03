import type { BudgetVsActual, TransactionCalendarResponse } from '@/types'
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

export interface BudgetOverviewTotals {
  budget: number
  hasBudget: boolean
  actual: number
  projected: number
  hasActivity: boolean
  remaining: number
  unbudgeted: number
  daysElapsed: number
  daysRemaining: number
  safeDaily: number
  expectedAtPace: number
  paceDelta: number
}

export function averageActualForCategory(months: BudgetVsActual[][], categoryId: string): number {
  if (months.length === 0) return 0
  const total = months.reduce((sum, rows) => {
    const category = rows.find((row) => row.category_id === categoryId)
    return sum + (category?.actual_amount ?? 0)
  }, 0)
  return total / months.length
}

export function summarizeBudgetHistory(months: Array<Pick<BudgetOverviewTotals, 'budget' | 'actual'>>) {
  const budgetedMonths = months.filter((month) => month.budget > 0)
  return {
    underBudgetMonths: budgetedMonths.filter((month) => month.actual <= month.budget).length,
    budgetedMonths: budgetedMonths.length,
  }
}

export function summarizeBudgetMonth(
  rows: BudgetVsActual[],
  month: string,
  now = new Date(),
): BudgetOverviewTotals {
  const budgeted = rows.filter((row) => row.budget_amount !== null && row.budget_amount > 0)
  const budget = budgeted.reduce((sum, row) => sum + row.budget_amount!, 0)
  const actual = rows.reduce((sum, row) => sum + row.actual_amount, 0)
  const projected = rows.reduce((sum, row) => sum + row.projected_amount, 0)
  const unbudgeted = rows
    .filter((row) => row.budget_amount == null || row.budget_amount <= 0)
    .reduce((sum, row) => sum + row.actual_amount, 0)

  const monthDays = monthLastDay(month)
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const daysElapsed = month < currentMonth ? monthDays : month > currentMonth ? 0 : now.getDate()
  const daysRemaining = Math.max(0, monthDays - daysElapsed)
  const remaining = budget - actual
  const expectedAtPace = daysElapsed > 0 ? (actual / daysElapsed) * monthDays : projected

  return {
    budget,
    hasBudget: budget > 0,
    actual,
    projected,
    hasActivity: actual !== 0 || projected !== 0,
    remaining,
    unbudgeted,
    daysElapsed,
    daysRemaining,
    safeDaily: daysRemaining > 0 ? Math.max(0, remaining / daysRemaining) : 0,
    expectedAtPace,
    paceDelta: budget > 0 ? budget * (daysElapsed / monthDays) - actual : 0,
  }
}

export function buildBudgetPaceSeries(
  calendar: TransactionCalendarResponse | undefined,
  month: string,
  budget: number,
  projectedTotal: number,
  today = new Date(),
) {
  const dayCount = monthLastDay(month)
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const elapsed = month < thisMonth ? dayCount : month > thisMonth ? 0 : today.getDate()
  const actualByDay = new Map(
    (calendar?.days ?? []).map((day) => [Number(day.date.slice(-2)), day.actual_expense]),
  )
  const plannedByDay = new Map(
    (calendar?.days ?? []).map((day) => [Number(day.date.slice(-2)), day.projected_expense]),
  )
  let actualCumulative = 0
  let plannedCumulative = 0

  return Array.from({ length: dayCount }, (_, index) => {
    const day = index + 1
    actualCumulative += actualByDay.get(day) ?? 0
    plannedCumulative += plannedByDay.get(day) ?? 0
    const isElapsed = day <= elapsed
    const projection = isElapsed
      ? actualCumulative
      : (elapsed > 0 ? actualCumulative : 0) + plannedCumulative
    return {
      day,
      actual: isElapsed ? actualCumulative : null,
      planned: isElapsed ? null : projection,
      budget,
      monthEstimate: day === dayCount ? projectedTotal : null,
    }
  })
}

export function sortBudgetCategories(rows: BudgetVsActual[]): BudgetVsActual[] {
  return [...rows].sort((left, right) => {
    const leftPercent = left.budget_amount ? left.actual_amount / left.budget_amount : -1
    const rightPercent = right.budget_amount ? right.actual_amount / right.budget_amount : -1
    const leftBand = leftPercent > 1 ? 0 : leftPercent >= 0.8 ? 1 : 2
    const rightBand = rightPercent > 1 ? 0 : rightPercent >= 0.8 ? 1 : 2
    return leftBand - rightBand || rightPercent - leftPercent || right.actual_amount - left.actual_amount
  })
}
