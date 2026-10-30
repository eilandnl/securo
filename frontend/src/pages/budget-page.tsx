import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import BudgetOverviewPage from '@/pages/budget-overview'
import BudgetsPage from '@/pages/budgets'

type BudgetView = 'overview' | 'settings'

export default function BudgetPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const view: BudgetView = searchParams.get('view') === 'settings' ? 'settings' : 'overview'

  function selectView(nextView: BudgetView) {
    const next = new URLSearchParams(searchParams)
    next.set('view', nextView)
    setSearchParams(next)
  }

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-border" role="tablist" aria-label={t('nav.budgets')}>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'overview'}
          className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${view === 'overview' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          onClick={() => selectView('overview')}
        >
          {t('nav.budget')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'settings'}
          className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${view === 'settings' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          onClick={() => selectView('settings')}
        >
          {t('nav.budgetSettings')}
        </button>
      </div>
      <div role="tabpanel">
        {view === 'settings' ? <BudgetsPage /> : <BudgetOverviewPage />}
      </div>
    </div>
  )
}
