import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarIcon, PiggyBank, Repeat, Sparkles } from 'lucide-react'
import { format } from 'date-fns'
import { useDisplayLocale } from '@/hooks/use-display-locale'
import { monthLabel, shiftMonth } from '@/lib/month-utils'
import { categories as categoriesApi, categoryGroups as groupsApi, budgets as budgetsApi } from '@/lib/api'
import { extractApiError } from '@/lib/api-errors'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { MonthPicker } from '@/components/ui/monthpicker'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/page-header'
import { CategoryIcon } from '@/components/category-icon'
import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import { useAuth } from '@/contexts/auth-context'
import { useWorkspace } from '@/contexts/workspace-context'
import { useSidebarState } from '@/contexts/sidebar-state-context'
import { cn } from '@/lib/utils'
import { useEffectiveTimezone } from '@/hooks/use-timezone'
import { resolveDateFnsLocale } from '@/lib/date-fns-locale'
import { typicalActualForCategory } from '@/lib/budget-overview-utils'
import { parseBudgetDraft, planBudgetChange, type BudgetOperation } from '@/lib/budget-settings-utils'
import { todayInTimezone } from '@/lib/date-utils'
import { formatCurrency } from '@/lib/format'
import type { Category } from '@/types'

/** Months of history shown per category; the suggestion is the median of the latest three. */
const HISTORY_MONTHS = 6
const SUGGESTION_MONTHS = 3

const STEP_BUTTON = 'h-8 w-8 flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:border-border hover:text-foreground transition-all text-base'

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      {children}
    </div>
  )
}

function SectionHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="px-4 sm:px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  )
}

/** Six small bars, oldest first, so a category's usual spend is visible at a glance. */
function SpendHistory({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values, 1)
  return (
    <div className="hidden sm:flex h-6 items-end gap-0.5" aria-hidden>
      {values.map((value, index) => (
        <span
          key={index}
          title={labels[index]}
          className={`w-1.5 rounded-sm ${index === values.length - 1 ? 'bg-muted-foreground/60' : 'bg-muted-foreground/25'}`}
          style={{ height: `${Math.max(8, (value / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

export default function BudgetsPage() {
  const { t, i18n } = useTranslation()
  const { mask } = usePrivacyMode()
  const { user } = useAuth()
  const { canWrite } = useWorkspace()
  const { collapsed: sidebarCollapsed } = useSidebarState()
  const timeZone = useEffectiveTimezone()
  const today = todayInTimezone(timeZone)
  const [searchParams] = useSearchParams()
  const requestedMonth = searchParams.get('month')
  const validRequestedMonth = requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)
    ? requestedMonth
    : null
  const userCurrency = user?.preferences?.currency_display ?? 'USD'
  const locale = useDisplayLocale()
  const queryClient = useQueryClient()
  const [monthOverride, setMonthOverride] = useState<string | null>(() => validRequestedMonth)
  const selectedMonth = monthOverride ?? today.slice(0, 7)
  const [monthCalOpen, setMonthCalOpen] = useState(false)
  const uiLocale = i18n.resolvedLanguage ?? i18n.language
  const dateFnsLocale = resolveDateFnsLocale(uiLocale)
  const monthParam = `${selectedMonth}-01`
  const monthTitle = monthLabel(selectedMonth, uiLocale).replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase(uiLocale))
  // Drafts are per month: switching month starts from what is saved there.
  type DraftState = { month: string; drafts: Record<string, string>; recurring: Record<string, boolean> }
  const emptyDrafts = (): DraftState => ({ month: selectedMonth, drafts: {}, recurring: {} })
  const [draftState, setDraftState] = useState<DraftState>(emptyDrafts)
  const current = draftState.month === selectedMonth ? draftState : emptyDrafts()
  const drafts = current.drafts

  const fmt = (amount: number) => mask(formatCurrency(amount, userCurrency, locale))

  const { data: budgetsList, isLoading: budgetsLoading } = useQuery({
    queryKey: ['budgets', selectedMonth],
    queryFn: () => budgetsApi.list(monthParam),
  })
  const { data: categoriesList } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.list,
  })
  const { data: groupsList } = useQuery({
    queryKey: ['category-groups'],
    queryFn: groupsApi.list,
  })
  const historyMonthKeys = useMemo(
    () => Array.from({ length: HISTORY_MONTHS }, (_, index) => shiftMonth(selectedMonth, -(index + 1))),
    [selectedMonth],
  )
  // Same query as the budget overview's history, so the two pages share the cache.
  const { data: history } = useQuery({
    queryKey: ['budgets', 'history', selectedMonth],
    queryFn: async () => Promise.all(historyMonthKeys.map((key) => budgetsApi.comparison(`${key}-01`))),
  })

  const budgetByCategory = useMemo(
    () => new Map((budgetsList ?? []).map((budget) => [budget.category_id, budget])),
    [budgetsList],
  )
  const savedAmount = (categoryId: string) => Number(budgetByCategory.get(categoryId)?.amount ?? 0)
  const draftFor = (categoryId: string) => drafts[categoryId] ?? (savedAmount(categoryId) > 0 ? String(savedAmount(categoryId)) : '')
  // New budgets repeat every month unless switched off, like the old add dialog's default.
  const recurringFor = (categoryId: string) => current.recurring[categoryId] ?? budgetByCategory.get(categoryId)?.is_recurring ?? true
  const planFor = (categoryId: string) => planBudgetChange({
    categoryId,
    amount: parseBudgetDraft(draftFor(categoryId)),
    recurring: recurringFor(categoryId),
    current: budgetByCategory.get(categoryId),
    month: monthParam,
  })
  const suggestionFor = (categoryId: string) => history
    ? Math.round(typicalActualForCategory(history.slice(0, SUGGESTION_MONTHS), categoryId))
    : 0

  // Visible spending categories, in their groups; transfers and ignored categories never get a budget.
  const sections = useMemo(() => {
    const budgetable = (category: Category) => !category.treat_as_transfer && !category.is_ignored
    const grouped = (groupsList ?? [])
      .filter((group) => !group.is_hidden)
      .map((group) => ({ id: group.id, name: group.name, categories: group.categories.filter((category) => !category.is_hidden && budgetable(category)) }))
      .filter((group) => group.categories.length > 0)
    const ungrouped = (categoriesList ?? []).filter((category) => !category.group_id && budgetable(category))
    return ungrouped.length ? [...grouped, { id: 'ungrouped', name: t('budgets.otherCategories'), categories: ungrouped }] : grouped
  }, [groupsList, categoriesList, t])
  const allCategories = sections.flatMap((section) => section.categories)

  const operations = allCategories.flatMap((category) => planFor(category.id))
  const changedCategories = new Set(allCategories.filter((category) => planFor(category.id).length > 0).map((category) => category.id))
  const totalBudget = allCategories.reduce((sum, category) => sum + parseBudgetDraft(draftFor(category.id)), 0)
  const typicalSpending = allCategories.reduce((sum, category) => sum + suggestionFor(category.id), 0)
  const suggestionsToApply = allCategories.filter((category) => {
    const suggestion = suggestionFor(category.id)
    return suggestion > 0 && parseBudgetDraft(draftFor(category.id)) !== suggestion
  })

  const updateDrafts = (change: (state: DraftState) => Partial<DraftState>) =>
    setDraftState((state) => {
      const base = state.month === selectedMonth ? state : emptyDrafts()
      return { ...base, ...change(base) }
    })
  const setDraft = (categoryId: string, value: string) =>
    updateDrafts((state) => ({ drafts: { ...state.drafts, [categoryId]: value } }))
  const toggleRecurring = (categoryId: string) =>
    updateDrafts((state) => ({ recurring: { ...state.recurring, [categoryId]: !recurringFor(categoryId) } }))

  const saveMutation = useMutation({
    mutationFn: async (planned: BudgetOperation[]) => {
      // Sequential: a delete must land before the create that replaces it.
      for (const operation of planned) {
        if (operation.type === 'create') await budgetsApi.create(operation.data)
        else if (operation.type === 'update') await budgetsApi.update(operation.id, operation.data)
        else await budgetsApi.delete(operation.id)
      }
    },
    onSuccess: () => {
      setDraftState(emptyDrafts())
      toast.success(t('budgets.saved'))
    },
    onError: (error: unknown) => toast.error(extractApiError(error, t('common.error'))),
    // Even a partly failed save changed some budgets; show what is stored now.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['budgets'] }),
  })

  const historyLabels = [...historyMonthKeys].reverse().map((key) => monthLabel(key, uiLocale))

  return (
    <div className={canWrite ? 'pb-28' : undefined}>
      <PageHeader
        section={t('nav.groupSetup')}
        title={t('budgets.settingsTitle')}
        action={
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" className={STEP_BUTTON} aria-label={t('budgetOverview.previousMonth')} onClick={() => setMonthOverride((value) => shiftMonth(value ?? selectedMonth, -1))}>‹</button>
            <Popover open={monthCalOpen} onOpenChange={setMonthCalOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 border border-border rounded-lg px-3 py-1.5 text-sm bg-card text-foreground hover:bg-muted/50 transition-all cursor-pointer min-w-[180px]"
                >
                  <CalendarIcon className="size-3.5 text-muted-foreground" />
                  {monthTitle}
                </button>
              </PopoverTrigger>
              <PopoverContent align="center" className="w-auto p-0">
                <MonthPicker
                  locale={dateFnsLocale}
                  selectedMonth={new Date(`${selectedMonth}-01T00:00:00`)}
                  onMonthSelect={(date) => {
                    if (!date) return
                    setMonthOverride(format(date, 'yyyy-MM'))
                    setMonthCalOpen(false)
                  }}
                />
              </PopoverContent>
            </Popover>
            <button type="button" className={STEP_BUTTON} aria-label={t('budgetOverview.nextMonth')} onClick={() => setMonthOverride((value) => shiftMonth(value ?? selectedMonth, 1))}>›</button>
            <Button asChild variant="outline" size="sm" className="ml-2 gap-1.5">
              <Link to={`/budget?month=${selectedMonth}`}><PiggyBank size={14} />{t('nav.budget')}</Link>
            </Button>
          </div>
        }
      />

      <SectionCard>
        <SectionHeader
          title={t('budgets.monthBudgets', { month: monthTitle })}
          description={t('budgets.suggestionsHint')}
          action={canWrite && suggestionsToApply.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8"
              onClick={() => updateDrafts((state) => ({
                drafts: { ...state.drafts, ...Object.fromEntries(suggestionsToApply.map((category) => [category.id, String(suggestionFor(category.id))])) },
              }))}
            >
              <Sparkles size={13} /> {t('budgets.useAllSuggestions')}
            </Button>
          ) : undefined}
        />

        {budgetsLoading || !groupsList ? (
          <div className="p-5 space-y-3">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)}</div>
        ) : allCategories.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">{t('budgets.noCategories')}</p>
        ) : (
          sections.map((section) => (
            <div key={section.id}>
              <p className="bg-muted/30 px-4 sm:px-5 py-2 text-xs font-medium text-muted-foreground border-b border-border">{section.name}</p>
              <div className="divide-y divide-border border-b border-border">
                {section.categories.map((category) => {
                  const draft = draftFor(category.id)
                  const amount = parseBudgetDraft(draft)
                  const suggestion = suggestionFor(category.id)
                  const values = history ? [...history].reverse().map((rows) => rows.find((row) => row.category_id === category.id)?.actual_amount ?? 0) : []
                  const changed = changedCategories.has(category.id)
                  const recurring = recurringFor(category.id)
                  return (
                    <div key={category.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5">
                      <CategoryIcon icon={category.icon} color={category.color} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{category.name}</p>
                        {suggestion > 0 && (
                          <p className="text-[11px] text-muted-foreground tabular-nums">
                            {t('budgets.average', { amount: fmt(suggestion) })}
                            {canWrite && Math.abs(amount - suggestion) > suggestion * 0.02 && (
                              <>
                                {' · '}
                                <button type="button" className="text-primary hover:underline" onClick={() => setDraft(category.id, String(suggestion))}>
                                  {t('budgets.useSuggestion')}
                                </button>
                              </>
                            )}
                          </p>
                        )}
                      </div>
                      {values.length > 0 && (
                        <SpendHistory values={values} labels={values.map((value, index) => `${historyLabels[index]}: ${fmt(value)}`)} />
                      )}
                      <button
                        type="button"
                        aria-pressed={recurring}
                        aria-label={t('budgets.repeatEveryMonthFor', { category: category.name })}
                        title={t('budgets.repeatEveryMonth')}
                        disabled={!canWrite}
                        onClick={() => toggleRecurring(category.id)}
                        className={`p-1.5 rounded-md transition-colors disabled:opacity-60 ${recurring ? 'text-primary bg-primary/10 hover:bg-primary/15' : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted'}`}
                      >
                        <Repeat size={13} />
                      </button>
                      <div className={`flex w-32 shrink-0 items-center rounded-lg border bg-card px-2.5 focus-within:ring-2 focus-within:ring-primary ${changed ? 'border-primary/60' : 'border-border'}`}>
                        <span className="text-xs text-muted-foreground">{formatCurrency(0, userCurrency, locale).replace(/[\d.,\s]/g, '')}</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={t('budgets.budgetFor', { category: category.name })}
                          placeholder="0"
                          value={draft}
                          disabled={!canWrite}
                          onChange={(event) => setDraft(category.id, event.target.value)}
                          className="h-8 w-full min-w-0 bg-transparent text-right text-sm font-semibold tabular-nums text-foreground outline-none placeholder:text-muted-foreground/50 disabled:opacity-60"
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </SectionCard>

      {/* Save bar: same fixed placement as the transactions bulk-action bar, so it
          stays in reach while editing a long list. */}
      {canWrite && allCategories.length > 0 && (
        <div className={cn(
          'fixed bottom-0 left-0 right-0 z-40',
          'transition-[left] duration-300 ease-in-out motion-reduce:transition-none',
          sidebarCollapsed ? 'lg:left-16' : 'lg:left-60',
        )}>
          <div className="mx-auto max-w-7xl px-3 md:px-6 pb-4 md:pb-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-card border border-border shadow-xl rounded-2xl px-4 py-3">
              <div className="text-sm tabular-nums">
                <span className="font-semibold text-foreground">{t('budgets.total', { amount: fmt(totalBudget) })}</span>
                {typicalSpending > 0 && (
                  <span className="text-muted-foreground"> · {t('budgets.typicalSpending', { amount: fmt(typicalSpending) })}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" disabled={operations.length === 0 || saveMutation.isPending} onClick={() => setDraftState(emptyDrafts())}>
                  {t('common.cancel')}
                </Button>
                <Button size="sm" disabled={operations.length === 0 || saveMutation.isPending} onClick={() => saveMutation.mutate(operations)}>
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
