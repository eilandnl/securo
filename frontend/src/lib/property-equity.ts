import type { Account, Asset } from '@/types'
import { getAssetValuePrimary } from '@/lib/asset-portfolio-share'

type ValuedProperty = Pick<Asset, 'id' | 'type' | 'current_value' | 'current_value_primary'>
type LinkedLoan = Pick<Account, 'type' | 'secured_asset_id' | 'current_balance' | 'balance_primary'>

export function getNetAssetValuePrimary(asset: ValuedProperty, accounts: LinkedLoan[]): number {
  const value = getAssetValuePrimary(asset) ?? 0
  if (asset.type !== 'real_estate') return value

  const debt = accounts
    .filter(account => account.type === 'loan' && account.secured_asset_id === asset.id)
    .reduce((total, account) => total + Math.max(0, -(account.balance_primary ?? account.current_balance)), 0)

  return value - debt
}
