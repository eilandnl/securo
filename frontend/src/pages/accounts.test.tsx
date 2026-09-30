import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'

import AccountsPage from '@/pages/accounts'
import { renderWithProviders, t } from '@/test/utils'

const api = vi.hoisted(() => ({
  accounts: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
  assets: { list: vi.fn() },
  connections: { list: vi.fn(), getProviders: vi.fn() },
  currencies: { list: vi.fn() },
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))

vi.mock('@/lib/api', () => api)
vi.mock('sonner', () => ({ toast }))
vi.mock('@/hooks/use-privacy-mode', () => ({
  usePrivacyMode: () => ({ mask: (value: string) => value, privacyMode: false, MASK: '••••' }),
}))
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ user: { preferences: { currency_display: 'EUR' } } }),
}))
vi.mock('@/contexts/workspace-context', () => ({
  useWorkspace: () => ({ canWrite: true }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  api.accounts.list.mockResolvedValue([])
  api.assets.list.mockResolvedValue([])
  api.connections.list.mockResolvedValue([])
  api.connections.getProviders.mockResolvedValue([])
  api.currencies.list.mockResolvedValue([{ code: 'EUR', symbol: '€', name: 'Euro', flag: '' }])
})

describe('Accounts page', () => {
  it('tells the user why a new account was refused', async () => {
    api.accounts.create.mockRejectedValue({
      response: { data: { detail: 'Linked property must be real estate in the same workspace' } },
    })
    const { user } = renderWithProviders(<AccountsPage />)

    await user.click(await screen.findByRole('button', { name: t('accounts.addManual') }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getAllByRole('textbox')[0], 'Mortgage')
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Linked property must be real estate in the same workspace',
      ),
    )
  })

  it('falls back to a generic message when the API gives no reason', async () => {
    api.accounts.create.mockRejectedValue(new Error('Network Error'))
    const { user } = renderWithProviders(<AccountsPage />)

    await user.click(await screen.findByRole('button', { name: t('accounts.addManual') }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getAllByRole('textbox')[0], 'Mortgage')
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t('common.error')))
  })
})
