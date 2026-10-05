import type { Budget } from '@/types'

export type BudgetOperation =
  | { type: 'create'; data: { category_id: string; amount: number; month: string; is_recurring: boolean } }
  | { type: 'update'; id: string; data: { amount: number; effective_month?: string } }
  | { type: 'delete'; id: string }

/** A draft input as an amount; empty or invalid means "no budget" (0). */
export function parseBudgetDraft(draft: string): number {
  const amount = Number(draft.replace(',', '.'))
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0
}

function nextMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const next = new Date(year, monthNumber, 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
}

/**
 * The API calls that give `categoryId` the budget `amount` in `month`
 * (`YYYY-MM-01`), repeating every month or only this month. `current` is the
 * budget that applies to that month today: a month-only budget or the
 * recurring budget it inherits.
 *
 * A recurring budget changed from this month on keeps earlier months as they
 * were (`effective_month`). Clearing a budget deletes it when it starts this
 * month, as the old per-budget delete did; a recurring budget that started
 * earlier is set to 0 instead, so the months before keep their budget.
 */
export function planBudgetChange({
  categoryId,
  amount,
  recurring,
  current,
  month,
}: {
  categoryId: string
  amount: number
  recurring: boolean
  current: Budget | undefined
  month: string
}): BudgetOperation[] {
  // The API sends decimals as strings.
  const currentAmount = Number(current?.amount ?? 0)
  const startsThisMonth = current?.month === month
  if (currentAmount === amount && (amount === 0 || current?.is_recurring === recurring)) return []

  if (amount === 0) {
    if (!current) return []
    if (!current.is_recurring || startsThisMonth) return [{ type: 'delete', id: current.id }]
    return recurring
      ? [{ type: 'update', id: current.id, data: { amount: 0, effective_month: month } }]
      : [{ type: 'create', data: { category_id: categoryId, amount: 0, month, is_recurring: false } }]
  }

  if (recurring) {
    if (current?.is_recurring) {
      return [{ type: 'update', id: current.id, data: { amount, effective_month: month } }]
    }
    return [
      ...(current ? [{ type: 'delete', id: current.id } as const] : []),
      { type: 'create', data: { category_id: categoryId, amount, month, is_recurring: true } },
    ]
  }

  if (current && !current.is_recurring) {
    return [{ type: 'update', id: current.id, data: { amount } }]
  }
  if (current?.is_recurring && currentAmount === amount) {
    // Same amount, no longer repeating: this month keeps it, later months stop.
    return [{ type: 'update', id: current.id, data: { amount: 0, effective_month: nextMonth(month) } }]
  }
  return [{ type: 'create', data: { category_id: categoryId, amount, month, is_recurring: false } }]
}
