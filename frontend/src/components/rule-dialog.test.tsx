import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

import { RuleDialog } from '@/components/rule-dialog'
import { assets } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'

vi.mock('@/lib/api', () => ({
  assets: { list: vi.fn() },
  rules: { preview: vi.fn() },
}))

vi.mock('@/hooks/use-display-locale', () => ({
  useDisplayLocale: () => 'en-US',
  useDateLocale: () => 'en-US',
}))

const contributionAsset = {
  id: 'asset-meesman',
  name: 'Meesman Wereldwijd',
  type: 'investment',
  valuation_method: 'growth_rule',
  growth_type: 'percentage',
  growth_rate: 8,
  is_archived: false,
  currency: 'EUR',
}

function renderRuleDialog(onSave = vi.fn()) {
  return renderWithProviders(
    <RuleDialog
      open
      onClose={vi.fn()}
      rule={null}
      categories={[]}
      categoryGroups={[]}
      accounts={[]}
      payees={[]}
      onSave={onSave}
      loading={false}
      initialData={{
        name: 'Meesman storting',
        conditions: [{ field: 'description', op: 'contains', value: 'MEESMAN' }],
        actions: [{ op: 'set_category', value: '' }],
        applyToExisting: false,
      }}
    />,
  )
}

describe('RuleDialog investment contribution action', () => {
  afterEach(() => vi.resetAllMocks())

  it('lets a rule link a transaction to an investment asset', async () => {
    vi.mocked(assets.list).mockResolvedValue([contributionAsset] as never)
    const onSave = vi.fn()
    const { user } = renderRuleDialog(onSave)
    const dialog = screen.getByRole('dialog')

    const actionType = Array.from(dialog.querySelectorAll('select')).find(select =>
      Array.from(select.options).some(option => option.value === 'set_asset_contribution'),
    )
    expect(actionType).toBeDefined()
    fireEvent.change(actionType!, { target: { value: 'set_asset_contribution' } })

    await screen.findByRole('option', { name: 'Meesman Wereldwijd (EUR)' })
    const assetSelect = Array.from(dialog.querySelectorAll('select')).find(select =>
      Array.from(select.options).some(option => option.value === contributionAsset.id),
    )
    expect(assetSelect).toBeDefined()
    fireEvent.change(assetSelect!, { target: { value: contributionAsset.id } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      actions: [{ op: 'set_asset_contribution', value: contributionAsset.id }],
    }))
  })

  it('keeps a contribution action selected while editing and saving a rule', async () => {
    vi.mocked(assets.list).mockResolvedValue([contributionAsset] as never)
    const onSave = vi.fn()
    const { user } = renderWithProviders(
      <RuleDialog
        open
        onClose={vi.fn()}
        rule={{
          id: 'rule-1',
          user_id: 'user-1',
          name: 'Meesman',
          conditions_op: 'and',
          conditions: [{ field: 'description', op: 'contains', value: 'MEESMAN' }],
          actions: [{ op: 'set_asset_contribution', value: contributionAsset.id }],
          priority: 1,
          is_active: true,
        }}
        categories={[]}
        categoryGroups={[]}
        accounts={[]}
        payees={[]}
        onSave={onSave}
        loading={false}
      />,
    )
    await screen.findByRole('option', { name: 'Meesman Wereldwijd (EUR)' })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      actions: [{ op: 'set_asset_contribution', value: contributionAsset.id }],
    }))
  })
})
