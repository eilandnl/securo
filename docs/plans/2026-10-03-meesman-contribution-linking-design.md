# Meesman Contribution Linking Design

## Goal

Automatically link actual Meesman bank debits to the existing Meesman investment asset so contributions increase its value and then accrue the configured 8% annual growth, without counting a payment twice.

## Chosen behavior

- A bank transaction can be linked to one investment asset as a contribution. The transaction amount and booking date are the contribution amount and date; no guessed fund units or execution price are recorded.
- A transaction rule can set the contribution asset. The rule can match payee text such as “Meesman”, and the existing rule preview/apply-to-existing workflow lets the user review and apply historical matches. New matching transactions are linked during the existing rule application path.
- Only posted debit transactions may contribute, and the chosen asset must belong to the same workspace and use percentage-based `growth_rule` valuation. A transaction can contribute to at most one asset.
- The asset value history is regenerated from its opening value and linked contributions in date order. Each contribution is added once on its booking date; the configured percentage growth is applied over the elapsed time afterward. For the Meesman asset this uses the user’s 8% annual setting.
- The linked bank transaction remains visible and is reported as an investment contribution rather than ordinary spending. The reduction in cash and increase in investment therefore offset in net worth, apart from growth.
- Editing or deleting a linked transaction recalculates the asset history. Unlinking removes that contribution. Deleting an asset clears its transaction links. Applying rules repeatedly is idempotent because the transaction itself stores the link.
- This contribution model estimates value from deposits and the configured growth rate; it does not represent actual Meesman units or daily fund prices.

## Architecture

Add a nullable asset-contribution foreign key to bank transactions and a rule action that assigns it. Keep the existing `asset_transactions` buy/sell ledger for quoted holdings unchanged. Extend asset value generation to consume linked contribution transactions for percentage-growth assets, and call the recalculation path when a link, transaction amount/date, or transaction lifecycle changes. Add a rule-editor action for selecting the target asset, with workspace and valuation-method validation.

## Scope and compatibility

Implement on `local/combined`, retaining the budget dashboard and the existing real-estate mortgage links, multiple loan parts, and principal/interest allocations. Do not copy the local test database to the live service as part of this feature.

## Validation

- Verify the migration adds a nullable, indexed, workspace-safe link that clears when its asset is deleted.
- Verify rule application handles valid and invalid assets, historical previews, repeated application, and future imports.
- Verify asset value replay with an opening balance, one or more dated contributions, 8% annual growth, edits, unlink, and deletion.
- Verify linked amounts remain investment contributions and do not become ordinary spending or duplicate net worth.
- Run focused backend and frontend checks, then verify the local preview still exposes budget and mortgage endpoints and screens.
