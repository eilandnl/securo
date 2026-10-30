import { describe, expect, it } from 'vitest'
import type { Budget } from '@/types'
import { parseBudgetDraft, planBudgetChange } from '@/lib/budget-settings-utils'

function budget(overrides: Partial<Budget>): Budget {
  return { id: 'b1', user_id: 'u', category_id: 'food', amount: 100, month: '2026-08-01', is_recurring: true, ...overrides }
}

const month = '2026-10-01'
const plan = (amount: number, recurring: boolean, current?: Budget) =>
  planBudgetChange({ categoryId: 'food', amount, recurring, current, month })

describe('parseBudgetDraft', () => {
  it('reads decimal commas and treats empty or invalid input as no budget', () => {
    expect(parseBudgetDraft('12,5')).toBe(12.5)
    expect(parseBudgetDraft('400')).toBe(400)
    expect(parseBudgetDraft('')).toBe(0)
    expect(parseBudgetDraft('abc')).toBe(0)
    expect(parseBudgetDraft('-5')).toBe(0)
  })
})

describe('planBudgetChange', () => {
  it('does nothing when amount and repetition are unchanged', () => {
    expect(plan(100, true, budget({}))).toEqual([])
    expect(plan(0, true, undefined)).toEqual([])
  })

  it('starts a new recurring amount from this month on', () => {
    expect(plan(150, true, budget({}))).toEqual([{ type: 'update', id: 'b1', data: { amount: 150, effective_month: month } }])
    expect(plan(150, true, undefined)).toEqual([
      { type: 'create', data: { category_id: 'food', amount: 150, month, is_recurring: true } },
    ])
  })

  it('turns a month-only budget into a recurring one', () => {
    expect(plan(100, true, budget({ id: 'o1', month, is_recurring: false }))).toEqual([
      { type: 'delete', id: 'o1' },
      { type: 'create', data: { category_id: 'food', amount: 100, month, is_recurring: true } },
    ])
  })

  it('changes only this month when not repeating', () => {
    expect(plan(80, false, budget({}))).toEqual([
      { type: 'create', data: { category_id: 'food', amount: 80, month, is_recurring: false } },
    ])
    expect(plan(80, false, budget({ id: 'o1', month, is_recurring: false }))).toEqual([
      { type: 'update', id: 'o1', data: { amount: 80 } },
    ])
  })

  it('stops a recurring budget after this month when repetition is switched off', () => {
    expect(plan(100, false, budget({}))).toEqual([
      { type: 'update', id: 'b1', data: { amount: 0, effective_month: '2026-11-01' } },
    ])
  })

  it('deletes a cleared budget that starts this month, and keeps earlier months of an older one', () => {
    expect(plan(0, true, budget({ id: 'o1', month, is_recurring: false }))).toEqual([{ type: 'delete', id: 'o1' }])
    expect(plan(0, true, budget({ month }))).toEqual([{ type: 'delete', id: 'b1' }])
    expect(plan(0, true, budget({}))).toEqual([{ type: 'update', id: 'b1', data: { amount: 0, effective_month: month } }])
    expect(plan(0, false, budget({}))).toEqual([
      { type: 'create', data: { category_id: 'food', amount: 0, month, is_recurring: false } },
    ])
  })
})
