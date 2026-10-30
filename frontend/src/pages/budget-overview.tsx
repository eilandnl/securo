import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertCircle, CalendarIcon, Settings2 } from 'lucide-react'
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PageHeader } from '@/components/page-header'
import { CategoryIcon } from '@/components/category-icon'
import { Button } from '@/components/ui/button'
import { MonthPicker } from '@/components/ui/monthpicker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/contexts/auth-context'
import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import { useDisplayLocale } from '@/hooks/use-display-locale'
import { useEffectiveTimezone } from '@/hooks/use-timezone'
import { budgets } from '@/lib/api'
import {
  buildBudgetPaceSeries,
  hasCategoryBudget,
  sortBudgetCategories,
  summarizeBudgetHistory,
  summarizeBudgetMonth,
  type CategoryForecast,
} from '@/lib/budget-overview-utils'
import { extractApiError } from '@/lib/api-errors'
import { todayInTimezone } from '@/lib/date-utils'
import { resolveDateFnsLocale } from '@/lib/date-fns-locale'
import { formatCurrency } from '@/lib/format'
import { monthLabel, monthRange, shiftMonth } from '@/lib/month-utils'

const HISTORY_MONTHS = 6

function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card rounded-xl border border-border shadow-sm overflow-hidden ${className}`}>
      {children}
    </div>
  )
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="px-4 sm:px-5 py-4 border-b border-border">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
    </div>
  )
}

function compactCurrency(amount: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(amount)
}

const STEP_BUTTON = 'h-8 w-8 flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:border-border hover:text-foreground transition-all text-base'

/** Same thresholds and colours as the budget bars on the dashboard. */
function usageColors(used: number) {
  if (used > 1) return { bar: 'bg-rose-500', text: 'text-rose-500' }
  if (used >= 0.8) return { bar: 'bg-amber-400', text: 'text-amber-500' }
  return { bar: 'bg-emerald-500', text: 'text-muted-foreground' }
}

const clampPercent = (share: number) => Math.min(100, Math.max(0, share * 100))

/** Dashboard budget bar; `expected` adds a faint segment up to the month-end forecast. */
function UsageBar({ used, expected }: { used: number; expected?: number }) {
  const ghost = expected !== undefined && expected > used ? expected : null
  return (
    <div className="relative flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden">
      {ghost !== null && (
        <div className={`absolute inset-y-0 left-0 rounded-full ${ghost > 1 ? 'bg-rose-500/25' : 'bg-muted-foreground/20'}`} style={{ width: `${clampPercent(ghost)}%` }} />
      )}
      <div className={`relative h-full rounded-full transition-all ${usageColors(used).bar}`} style={{ width: `${clampPercent(used)}%` }} />
    </div>
  )
}

function Indicator({ label, value, note, className = 'text-foreground', divider = false }: {
  label: string
  value: string
  note?: string
  className?: string
  divider?: boolean
}) {
  return (
    <div className={`relative min-w-0 ${divider ? "before:content-[''] before:hidden sm:before:block before:absolute before:-left-2.5 before:top-1.5 before:bottom-1.5 before:w-px before:bg-border" : ''}`}>
      <p className="text-xs font-medium text-muted-foreground mb-1 min-h-[16px] flex items-center">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${className}`}>{value}</p>
      {note && <p className="text-xs text-muted-foreground tabular-nums mt-1">{note}</p>}
    </div>
  )
}

export default function BudgetOverviewPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const { mask, privacyMode } = usePrivacyMode()
  const locale = useDisplayLocale()
  const language = i18n.resolvedLanguage ?? i18n.language
  const timeZone = useEffectiveTimezone()
  const today = todayInTimezone(timeZone)
  const todayDate = useMemo(() => new Date(`${today}T12:00:00`), [today])
  const currentMonth = today.slice(0, 7)
  const [searchParams] = useSearchParams()
  const requestedMonth = searchParams.get('month')
  const validRequestedMonth = requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)
    ? requestedMonth
    : null
  const currency = user?.preferences?.currency_display ?? 'USD'
  const [monthOverride, setMonthOverride] = useState<string | null>(() => validRequestedMonth)
  const month = monthOverride ?? currentMonth
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const monthParam = `${month}-01`
  const dateFnsLocale = resolveDateFnsLocale(language)
  const capitalize = (value: string) => value.replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase(language))
  const monthTitle = capitalize(monthLabel(month, language))
  const historyMonthKeys = useMemo(
    () => Array.from({ length: HISTORY_MONTHS }, (_, index) => shiftMonth(month, -(index + 1))),
    [month],
  )

  const {
    data: comparison,
    isLoading: comparisonLoading,
    error: comparisonErrorValue,
    refetch: refetchComparison,
  } = useQuery({
    queryKey: ['budgets', 'comparison', month],
    queryFn: () => budgets.comparison(monthParam),
  })
  // The forecast is an estimate on top of the real figures: when it fails the
  // page falls back to the comparison's own projection instead of an error.
  const { data: forecast, isLoading: forecastLoading } = useQuery({
    queryKey: ['budgets', 'forecast', month],
    queryFn: () => budgets.forecast(monthParam),
  })
  const {
    data: history,
    isLoading: historyLoading,
    isError: historyError,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['budgets', 'history', month],
    queryFn: async () => Promise.all(historyMonthKeys.map((key) => budgets.comparison(`${key}-01`))),
  })

  const rows = useMemo(() => comparison ?? [], [comparison])
  const forecasts = useMemo(() => forecast?.categories ?? new Map<string, CategoryForecast>(), [forecast])
  const expected = useMemo(
    () => new Map([...forecasts].map(([categoryId, categoryForecast]) => [categoryId, categoryForecast.expected])),
    [forecasts],
  )
  const totals = useMemo(() => summarizeBudgetMonth(rows, month, todayDate, forecasts), [rows, month, todayDate, forecasts])
  const budgetedRows = useMemo(() => sortBudgetCategories(rows.filter(hasCategoryBudget), expected), [rows, expected])
  // Categories only listed for last month's activity add nothing here.
  const unbudgetedRows = useMemo(
    () => rows.filter((row) => !hasCategoryBudget(row) && row.actual_amount > 0).sort((left, right) => right.actual_amount - left.actual_amount),
    [rows],
  )
  const chartData = useMemo(() => buildBudgetPaceSeries(month, {
    categoryIds: new Set((totals.hasBudget ? rows.filter(hasCategoryBudget) : rows).map((row) => row.category_id)),
    actualTotal: totals.hasBudget ? totals.budgetedActual : totals.actual,
    forecasts,
  }, todayDate), [month, rows, totals, forecasts, todayDate])

  const historyMonths = (history ?? []).map((historyRows, index) => {
    const historyTotals = summarizeBudgetMonth(historyRows, historyMonthKeys[index], todayDate)
    return { month: historyMonthKeys[index], ...historyTotals }
  })
  const historySummary = summarizeBudgetHistory(historyMonths.map((item) => ({ budget: item.budget, actual: item.budgetedActual })))

  const loading = comparisonLoading
  const pageError = comparisonErrorValue
  const retryPage = () => {
    void refetchComparison()
  }

  const fmt = (amount: number) => mask(formatCurrency(amount, currency, locale))
  const isCurrentMonth = totals.daysElapsed > 0 && totals.daysRemaining > 0
  const isClosedMonth = totals.daysRemaining === 0
  const forecastOverBudget = totals.hasBudget && totals.forecast > totals.budget + 0.005
  const monthStatus = isCurrentMonth
    ? t('budgetOverview.dayOfTotal', { day: totals.daysElapsed, total: totals.monthDays })
    : isClosedMonth ? t('budgetOverview.monthClosed') : t('budgetOverview.monthNotStarted')
  const transactionsLink = (categoryId: string) =>
    `/transactions?category_id=${encodeURIComponent(categoryId)}&from=${monthRange(month).from}&to=${monthRange(month).to}`
  const usedHistory = (forecast?.learnedMonths ?? 0) > 0 && [...forecasts.values()].some((categoryForecast) => categoryForecast.fromHistory)

  return (
    <div>
      <PageHeader
        section={t('nav.groupAnalysis')}
        title={t('nav.budget')}
        action={(
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" className={STEP_BUTTON} aria-label={t('budgetOverview.previousMonth')} onClick={() => setMonthOverride((value) => shiftMonth(value ?? month, -1))}>‹</button>
            <Popover open={monthPickerOpen} onOpenChange={setMonthPickerOpen}>
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
                  selectedMonth={new Date(`${month}-01T00:00:00`)}
                  onMonthSelect={(date) => {
                    if (!date) return
                    setMonthOverride(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
                    setMonthPickerOpen(false)
                  }}
                />
              </PopoverContent>
            </Popover>
            <button type="button" className={STEP_BUTTON} aria-label={t('budgetOverview.nextMonth')} onClick={() => setMonthOverride((value) => shiftMonth(value ?? month, 1))}>›</button>
            <Button asChild variant="outline" size="sm" className="ml-2 gap-1.5">
              <Link to={`/budgets?month=${month}`}><Settings2 size={14} />{t('nav.budgetSettings')}</Link>
            </Button>
          </div>
        )}
      />

      {pageError ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-500/30 dark:bg-rose-500/10">
          <div className="flex min-w-0 items-center gap-2.5">
            <AlertCircle className="size-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span className="truncate text-sm text-rose-900 dark:text-rose-200">{extractApiError(pageError, t('reports.loadError'))}</span>
          </div>
          <button type="button" onClick={retryPage} className="shrink-0 text-sm font-semibold text-rose-600 hover:underline dark:text-rose-400">{t('common.retry')}</button>
        </div>
      ) : loading ? (
        <Skeleton className="h-40 rounded-xl mb-5" />
      ) : (
        <>
          {/* Hero: same shell as the dashboard's balance card. */}
          <div className="bg-card rounded-xl border border-border shadow-sm mb-5 px-5 pt-5 pb-4">
            <div className="pb-4 mb-4 border-b border-border">
              <div className="flex items-center justify-between gap-3 mb-1">
                <p className="text-xs font-semibold text-muted-foreground">
                  {totals.hasBudget
                    ? totals.remaining < 0 ? t('budgetOverview.overBudget') : t('budgetOverview.remaining')
                    : t('budgetOverview.spentThisMonth')}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">{monthStatus}</p>
              </div>
              <p className={`text-3xl font-bold tabular-nums leading-tight ${totals.hasBudget && totals.remaining < 0 ? 'text-rose-500' : 'text-foreground'}`}>
                {fmt(totals.hasBudget ? Math.abs(totals.remaining) : totals.actual)}
              </p>
              {totals.hasBudget ? (
                <>
                  <div className="flex items-center gap-2 mt-3">
                    <UsageBar used={totals.usedShare} expected={isClosedMonth ? undefined : totals.forecast / totals.budget} />
                  </div>
                  {totals.unbudgeted > 0 && (
                    <p className="text-xs text-muted-foreground tabular-nums mt-2">{t('budgetOverview.spentOutsideBudget', { amount: fmt(totals.unbudgeted) })}</p>
                  )}
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2">
                  <p className="text-xs text-muted-foreground">{t('budgetOverview.noBudgetForMonth', { month: monthTitle })}</p>
                  <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                    <Link to={`/budgets?month=${month}`}>{t('budgetOverview.setBudgets')}</Link>
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-4">
              <Indicator label={t('budgetOverview.spent')} value={fmt(totals.hasBudget ? totals.budgetedActual : totals.actual)} />
              <Indicator divider label={t('budgetOverview.totalBudget')} value={totals.hasBudget ? fmt(totals.budget) : '—'} />
              <Indicator
                divider
                label={t('budgetOverview.monthEndEstimate')}
                value={isClosedMonth ? '—' : forecastLoading ? '…' : fmt(totals.forecast)}
                note={!isClosedMonth && forecastOverBudget ? t('budgetOverview.overBy', { amount: fmt(totals.forecast - totals.budget) }) : undefined}
                className={!isClosedMonth && forecastOverBudget ? 'text-amber-500' : 'text-foreground'}
              />
              <Indicator
                divider
                label={t('budgetOverview.safeDaily')}
                value={totals.hasBudget && totals.daysRemaining > 0 ? fmt(totals.safeDaily) : '—'}
                note={totals.hasBudget && totals.daysRemaining > 0 ? t('budgetOverview.forDays', { count: totals.daysRemaining }) : undefined}
              />
            </div>
          </div>

          {/* Spending chart: same series styling as the dashboard's balance flow. */}
          {(totals.hasBudget || totals.hasActivity) && (
            <div className="bg-card rounded-xl border border-border shadow-sm mb-5">
              <div className="px-5 pt-5 pb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('budgetOverview.spendingThisMonth')}</p>
                  {!isClosedMonth && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {usedHistory ? t('budgetOverview.forecastHistoryHint') : t('budgetOverview.forecastHint')}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="inline-block w-3 h-0.5 rounded-full bg-emerald-500" />
                    {t('budgetOverview.actualToDate')}
                  </span>
                  {!isClosedMonth && (
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="inline-block w-3 border-t-2 border-dashed border-slate-400" />
                      {t('budgetOverview.forecastLine')}
                    </span>
                  )}
                  {totals.hasBudget && (
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="inline-block w-3 border-t border-dashed border-rose-400" />
                      {t('budgetOverview.totalBudget')}
                    </span>
                  )}
                </div>
              </div>
              <div className="h-[260px] px-1 pb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="budgetSpendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} interval={3} />
                    <YAxis
                      tickFormatter={(value: number) => (privacyMode ? '' : compactCurrency(value, currency, locale))}
                      tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                      axisLine={false}
                      tickLine={false}
                      width={56}
                      tickCount={5}
                    />
                    <ChartTooltip
                      formatter={(value, name) => [
                        fmt(Number(value)),
                        name === 'actual' ? t('budgetOverview.actualToDate') : t('budgetOverview.forecastLine'),
                      ]}
                      labelFormatter={(day) => t('budgetOverview.dayOfMonth', { day })}
                      contentStyle={{
                        background: 'var(--card)',
                        color: 'var(--foreground)',
                        border: '1px solid var(--border)',
                        borderRadius: '0.75rem',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                        fontSize: '12px',
                      }}
                    />
                    {totals.hasBudget && (
                      <ReferenceLine y={totals.budget} ifOverflow="extendDomain" stroke="#FB7185" strokeDasharray="4 4" strokeWidth={1} />
                    )}
                    <Area type="monotone" dataKey="actual" stroke="#10B981" strokeWidth={2} fill="url(#budgetSpendGrad)" dot={false} activeDot={{ r: 3, fill: '#10B981' }} connectNulls={false} />
                    <Line type="stepAfter" dataKey="forecast" stroke="#94A3B8" strokeWidth={2} strokeDasharray="5 3" dot={false} activeDot={{ r: 3, fill: '#94A3B8' }} connectNulls={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Category budgets: one compact row each, dashboard bar colours. */}
          <SectionCard className="mb-5">
            <SectionHeader title={t('budgetOverview.categoryBudgets')} />
            {budgetedRows.length === 0 && unbudgetedRows.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-muted-foreground text-sm">{t('budgetOverview.noData')}</p>
                <Button asChild variant="outline" size="sm" className="mt-4"><Link to={`/budgets?month=${month}`}>{t('budgetOverview.setBudgets')}</Link></Button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {budgetedRows.map((row) => {
                  const used = row.actual_amount / row.budget_amount!
                  const categoryExpected = expected.get(row.category_id) ?? row.actual_amount
                  const left = row.budget_amount! - row.actual_amount
                  const expectedOver = !isClosedMonth && categoryExpected > row.budget_amount! + 0.005
                  return (
                    <Link
                      key={row.category_id}
                      to={transactionsLink(row.category_id)}
                      title={!isClosedMonth ? t('budgetOverview.expectedAmount', { amount: fmt(categoryExpected) }) : undefined}
                      aria-label={`${t('budgetOverview.viewTransactionsFor', { category: row.category_name })} · ${monthTitle}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_12rem] items-center gap-x-4 gap-y-1.5 px-4 sm:px-5 py-3 hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <CategoryIcon icon={row.category_icon} color={row.category_color} size="md" />
                        <span className="truncate text-sm font-medium text-foreground">{row.category_name}</span>
                      </span>
                      <span className="order-last col-span-2 sm:order-none sm:col-span-1 flex items-center">
                        <UsageBar used={used} expected={isClosedMonth ? undefined : categoryExpected / row.budget_amount!} />
                      </span>
                      <span className="text-right tabular-nums">
                        <span className="block text-sm font-semibold text-foreground">
                          {fmt(row.actual_amount)}<span className="font-normal text-xs text-muted-foreground"> / {fmt(row.budget_amount!)}</span>
                        </span>
                        <span className={`block text-[11px] ${left < 0 ? 'text-rose-500' : expectedOver ? 'text-amber-500' : 'text-muted-foreground'}`}>
                          {left < 0
                            ? t('budgetOverview.overAmount', { amount: fmt(-left) })
                            : expectedOver
                              ? t('budgetOverview.expectedAmount', { amount: fmt(categoryExpected) })
                              : t('budgetOverview.leftAmount', { amount: fmt(left) })}
                        </span>
                      </span>
                    </Link>
                  )
                })}
                {unbudgetedRows.length > 0 && (
                  <>
                    <div className="flex items-center justify-between gap-3 bg-muted/30 px-4 sm:px-5 py-2">
                      <span className="text-xs font-medium text-muted-foreground">{t('budgetOverview.withoutBudget')}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{fmt(totals.unbudgeted)}</span>
                    </div>
                    {unbudgetedRows.map((row) => (
                      <Link
                        key={row.category_id}
                        to={transactionsLink(row.category_id)}
                        aria-label={`${t('budgetOverview.viewTransactionsFor', { category: row.category_name })} · ${monthTitle}`}
                        className="flex items-center gap-3 px-4 sm:px-5 py-2.5 hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                      >
                        <CategoryIcon icon={row.category_icon} color={row.category_color} size="sm" />
                        <span className="flex-1 truncate text-sm text-foreground">{row.category_name}</span>
                        <span className="text-sm tabular-nums text-foreground">{fmt(row.actual_amount)}</span>
                      </Link>
                    ))}
                  </>
                )}
              </div>
            )}
          </SectionCard>

          <SectionCard>
            <SectionHeader
              title={t('budgetOverview.history')}
              description={historySummary.budgetedMonths > 0
                ? t('budgetOverview.monthsUnderBudget', { count: historySummary.underBudgetMonths, total: historySummary.budgetedMonths })
                : undefined}
            />
            {historyLoading ? (
              <div className="p-4 sm:p-5"><Skeleton className="h-24 w-full" /></div>
            ) : historyError ? (
              <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-4 text-sm text-destructive">
                <span>{t('reports.loadError')}</span>
                <button type="button" onClick={() => { void refetchHistory() }} className="shrink-0 font-semibold hover:underline">{t('common.retry')}</button>
              </div>
            ) : historyMonths.some((item) => item.hasBudget || item.hasActivity) ? (
              <div className="divide-y divide-border">
                {historyMonths.map((item) => (
                  <button
                    key={item.month}
                    type="button"
                    onClick={() => setMonthOverride(item.month)}
                    className="w-full flex items-center gap-4 px-4 sm:px-5 py-3 text-left hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  >
                    <span className="w-28 shrink-0 text-sm font-medium text-foreground">{capitalize(monthLabel(item.month, language))}</span>
                    {item.hasBudget ? (
                      <>
                        <UsageBar used={item.usedShare} />
                        <span className="hidden sm:block w-44 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {t('budgetOverview.usedOfBudget', { spent: fmt(item.budgetedActual), budget: fmt(item.budget) })}
                        </span>
                      </>
                    ) : (
                      <span className="flex-1 text-xs text-muted-foreground">{t('budgetOverview.noBudgetSet')}</span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-10">{t('budgetOverview.noHistory')}</p>
            )}
          </SectionCard>
        </>
      )}
    </div>
  )
}
