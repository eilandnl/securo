import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import BudgetOverviewPage from '@/pages/budget-overview'
import { renderWithProviders, t } from '@/test/utils'
import type { BudgetVsActual } from '@/types'

const api = vi.hoisted(() => ({
  budgets: { comparison: vi.fn(), forecast: vi.fn() },
}))

vi.mock('@/lib/api', () => ({ budgets: api.budgets }))

vi.mock('@/hooks/use-display-locale', () => ({
  useDisplayLocale: () => 'en-US',
  useDateLocale: () => 'en-US',
}))

vi.mock('@/hooks/use-timezone', () => ({
  useEffectiveTimezone: () => 'UTC',
}))

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ user: { preferences: { currency_display: 'USD' } } }),
}))

vi.mock('@/hooks/use-privacy-mode', () => ({
  usePrivacyMode: () => ({ mask: (value: string) => value, privacyMode: false, MASK: '••••' }),
}))

function row(overrides: Partial<BudgetVsActual>): BudgetVsActual {
  return {
    category_id: 'category',
    category_name: 'Category',
    category_icon: 'shopping-cart',
    category_color: '#000000',
    group_id: null,
    group_name: null,
    budget_amount: null,
    actual_amount: 0,
    projected_amount: 0,
    prev_month_amount: 0,
    projected_prev_month_amount: 0,
    percentage_used: null,
    is_recurring: false,
    ...overrides,
  }
}


beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 10, 12)))
  vi.clearAllMocks()
  api.budgets.forecast.mockResolvedValue({ learnedMonths: 0, categories: new Map() })
})

afterEach(() => vi.useRealTimers())

describe('Budget overview page', () => {
  it('measures the budget against budgeted categories and lists unbudgeted spending separately', async () => {
    api.budgets.comparison.mockImplementation(async (month: string) => month === '2026-10-01'
      ? [
          row({ category_id: 'rent', category_name: 'Rent', budget_amount: 1000, actual_amount: 1000, projected_amount: 1000 }),
          row({ category_id: 'food', category_name: 'Groceries', budget_amount: 400, actual_amount: 100, projected_amount: 100 }),
          row({ category_id: 'gifts', category_name: 'Gifts', actual_amount: 25, projected_amount: 25 }),
          row({ category_id: 'stale', category_name: 'Only last month', prev_month_amount: 50 }),
        ]
      : [row({ category_id: 'food', budget_amount: 400, actual_amount: 350 })])

    renderWithProviders(<BudgetOverviewPage />)

    // 1400 budget − 1100 spent in budgeted categories; the 25 in Gifts does not count against it.
    expect(await screen.findByText('$300.00')).toBeInTheDocument()
    expect(screen.getByText(t('budgetOverview.spentOutsideBudget', { amount: '$25.00' }))).toBeInTheDocument()

    expect(screen.getByText(t('budgetOverview.withoutBudget'))).toBeInTheDocument()
    expect(screen.getByText('Gifts')).toBeInTheDocument()
    expect(screen.queryByText('Only last month')).not.toBeInTheDocument()

    // Most urgent first: Rent has used its whole budget, Groceries a quarter.
    const categoryLinks = screen.getAllByRole('link', { name: /View transactions for/ }).map((link) => link.getAttribute('aria-label'))
    expect(categoryLinks.slice(0, 2)).toEqual([
      expect.stringContaining('Rent'),
      expect.stringContaining('Groceries'),
    ])
    expect(screen.getByText(t('budgetOverview.leftAmount', { amount: '$300.00' }))).toBeInTheDocument()

    expect(screen.getByText(t('budgetOverview.dayOfTotal', { day: 10, total: 31 }))).toBeInTheDocument()
    expect(await screen.findByText(t('budgetOverview.monthsUnderBudget', { count: 6, total: 6 }))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('budgetOverview.nextMonth') })).toBeInTheDocument()
  })

  it('shows spending without budget figures when the month has no budget', async () => {
    api.budgets.comparison.mockResolvedValue([
      row({ category_id: 'food', category_name: 'Groceries', actual_amount: 80, projected_amount: 80 }),
    ])

    renderWithProviders(<BudgetOverviewPage />)

    expect(await screen.findByText(t('budgetOverview.noBudgetForMonth', { month: 'October 2026' }))).toBeInTheDocument()
    expect(screen.getByText(t('budgetOverview.spentThisMonth'))).toBeInTheDocument()
    expect(screen.queryByText(t('budgetOverview.remaining'))).not.toBeInTheDocument()
    expect(screen.getByText(t('budgetOverview.withoutBudget'))).toBeInTheDocument()
  })
})
