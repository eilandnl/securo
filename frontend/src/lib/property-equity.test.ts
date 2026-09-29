import { describe, expect, it } from 'vitest'

import { getLoanHistoryDebt, getNetAssetValuePrimary } from '@/lib/property-equity'

describe('property equity', () => {
  const property = { id: 'home', type: 'real_estate', current_value: 593000, current_value_primary: null }
  const loans = [
    { type: 'loan', secured_asset_id: 'home', current_balance: -194723.17, balance_primary: null },
    { type: 'loan', secured_asset_id: 'home', current_balance: -23556.84, balance_primary: null },
    { type: 'loan', secured_asset_id: 'other', current_balance: -48802.47, balance_primary: null },
  ]

  it('deducts all linked loan parts once from the property value', () => {
    expect(getNetAssetValuePrimary(property, loans)).toBeCloseTo(374719.99, 2)
  })

  it('uses converted loan balances when the loan currency differs', () => {
    expect(getNetAssetValuePrimary(
      { ...property, current_value_primary: 600000 },
      [{ ...loans[0], balance_primary: -200000 }],
    )).toBe(400000)
  })

  it('leaves non-property assets at their current value', () => {
    expect(getNetAssetValuePrimary({ ...property, type: 'crypto', current_value: 1000 }, loans)).toBe(1000)
  })

  it('does not count a positive overpayment as outstanding debt', () => {
    expect(getNetAssetValuePrimary(property, [
      { ...loans[0], current_balance: 25 },
    ])).toBe(593000)
  })

  it('reads history debt with the sign each loan kind reports', () => {
    expect(getLoanHistoryDebt(-200000, false)).toBe(200000)
    expect(getLoanHistoryDebt(200000, true)).toBe(200000)
  })

  it('treats an overpaid loan in history as no debt, like the current total', () => {
    expect(getLoanHistoryDebt(25, false)).toBe(0)
    expect(getLoanHistoryDebt(-25, true)).toBe(0)
  })
})
