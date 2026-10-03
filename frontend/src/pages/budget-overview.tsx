import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ArrowDownRight, ArrowUpRight, CalendarIcon, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
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
import { budgets, transactions } from '@/lib/api'
import { buildBudgetPaceSeries, sortBudgetCategories, summarizeBudgetHistory, summarizeBudgetMonth } from '@/lib/budget-overview-utils'
import { extractApiError } from '@/lib/api-errors'
import { todayInTimezone } from '@/lib/date-utils'
import { resolveDateFnsLocale } from '@/lib/date-fns-locale'
import { formatCurrency } from '@/lib/format'
import { monthLabel, monthRange, shiftMonth } from '@/lib/month-utils'

function compactCurrency(amount: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount)
}

function MetricCard({ label, value, note, accent = false }: {
  label: string
  value: string
  note?: string
  accent?: boolean
}) {
  return (
    <div className={`rounded-xl border p-4 sm:p-5 ${accent ? 'bg-primary/5 border-primary/15' : 'bg-card border-border'}`}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl sm:text-2xl font-semibold tracking-tight tabular-nums text-foreground">{value}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

function SummaryValue({ label, value, emphasis = false, negative = false }: {
  label: string
  value: string
  emphasis?: boolean
  negative?: boolean
}) {
  return (
    <div className={emphasis ? 'rounded-lg bg-primary/5 px-3 py-3 sm:px-4' : 'px-3 py-3 sm:px-4'}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1.5 text-xl sm:text-2xl font-semibold tracking-tight tabular-nums ${negative ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
    </div>
  )
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-4 sm:px-5 py-4 border-b border-border flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export default function BudgetOverviewPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const { mask } = usePrivacyMode()
  const locale = useDisplayLocale()
  const timeZone = useEffectiveTimezone()
  const today = todayInTimezone(timeZone)
  const todayDate = useMemo(() => new Date(`${today}T12:00:00`), [today])
  const [searchParams] = useSearchParams()
  const requestedMonth = searchParams.get('month')
  const validRequestedMonth = requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)
    ? requestedMonth
    : null
  const currency = user?.preferences?.currency_display ?? 'USD'
  const [monthOverride, setMonthOverride] = useState<string | null>(() => validRequestedMonth)
  const month = monthOverride ?? today.slice(0, 7)
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const monthParam = `${month}-01`
  const dateFnsLocale = resolveDateFnsLocale(i18n.resolvedLanguage ?? i18n.language)
  const monthTitle = monthLabel(month, i18n.resolvedLanguage ?? i18n.language)
    .replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase(i18n.resolvedLanguage ?? i18n.language))

  const {
    data: comparison,
    isLoading: comparisonLoading,
    error: comparisonErrorValue,
    refetch: refetchComparison,
  } = useQuery({
    queryKey: ['budgets', 'comparison', month],
    queryFn: () => budgets.comparison(monthParam),
  })
  const {
    data: calendar,
    isLoading: calendarLoading,
    error: calendarErrorValue,
    refetch: refetchCalendar,
  } = useQuery({
    queryKey: ['transactions', 'calendar', month],
    queryFn: () => transactions.calendar({ month: monthParam }),
  })
  const {
    data: history,
    isLoading: historyLoading,
    isError: historyError,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['budgets', 'history', month],
    queryFn: async () => Promise.all(
      Array.from({ length: 6 }, (_, index) => shiftMonth(month, -(index + 1)))
        .map((historyMonth) => budgets.comparison(`${historyMonth}-01`)),
    ),
  })

  const rows = useMemo(() => comparison ?? [], [comparison])
  const totals = useMemo(() => summarizeBudgetMonth(rows, month, todayDate), [rows, month, todayDate])
  const sortedRows = useMemo(() => sortBudgetCategories(rows), [rows])
  const chartData = useMemo(
    () => buildBudgetPaceSeries(calendar, month, totals.budget, totals.projected, todayDate),
    [calendar, month, totals.budget, totals.projected, todayDate],
  )
  const historyMonths = (history ?? []).map((historyRows, index) => {
    const historyMonth = shiftMonth(month, -(index + 1))
    const historyTotals = summarizeBudgetMonth(historyRows, historyMonth, todayDate)
    return { month: historyMonth, ...historyTotals, underBudget: historyTotals.budget > 0 && historyTotals.actual <= historyTotals.budget }
  }).reverse()
  const historySummary = summarizeBudgetHistory(historyMonths)
  const previousMonth = historyMonths[historyMonths.length - 1]
  const loading = comparisonLoading || calendarLoading
  const pageError = comparisonErrorValue ?? calendarErrorValue
  const retryPage = () => {
    void Promise.all([refetchComparison(), refetchCalendar()])
  }

  const fmt = (amount: number) => mask(formatCurrency(amount, currency, locale))
  const paceMessage = totals.hasBudget && totals.daysElapsed > 0 && totals.daysRemaining > 0
    ? totals.paceDelta >= 0
      ? t('budgetOverview.belowPace', { amount: fmt(totals.paceDelta) })
      : t('budgetOverview.abovePace', { amount: fmt(Math.abs(totals.paceDelta)) })
    : null

  return (
    <div className="space-y-5">
      <PageHeader
        section={t('nav.groupAnalysis')}
        title={t('nav.budget')}
        action={(
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="outline" size="icon" aria-label={t('dashboard.monthPrevious')} onClick={() => setMonthOverride((value) => shiftMonth(value ?? month, -1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <Popover open={monthPickerOpen} onOpenChange={setMonthPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="min-w-[170px] justify-center gap-2">
                  <CalendarIcon className="size-4 text-muted-foreground" />
                  {monthTitle}
                </Button>
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
            <Button variant="outline" size="icon" aria-label={t('dashboard.monthNext')} onClick={() => setMonthOverride((value) => shiftMonth(value ?? month, 1))}>
              <ChevronRight className="size-4" />
            </Button>
            <Button asChild variant="outline" className="ml-2 gap-2">
              <Link to={`/budgets?month=${month}`}><Settings2 className="size-4" />{t('nav.budgetSettings')}</Link>
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
        <Skeleton className="h-36 rounded-xl" />
      ) : (
        <>
          {!totals.hasBudget && (
            <div role="status" className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <p className="text-sm font-semibold text-foreground">{t('budgetOverview.noBudgetForMonth', { month: monthTitle })}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('budgetOverview.createBudgetPrompt')}</p>
              </div>
              <Button asChild variant="outline" className="shrink-0">
                <Link to={`/budgets?month=${month}`}>{t('budgetOverview.setBudgets')}</Link>
              </Button>
            </div>
          )}

          {(totals.hasBudget || totals.hasActivity) && (
            <Card
              title={t('budgetOverview.monthlySummary')}
              action={paceMessage ? (
                <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${totals.paceDelta >= 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
                  {totals.paceDelta >= 0 ? <ArrowDownRight className="inline size-3.5 mr-1" /> : <ArrowUpRight className="inline size-3.5 mr-1" />}
                  {paceMessage}
                </span>
              ) : undefined}
            >
              <div className="p-2 sm:p-3">
                <div className={`grid ${totals.hasBudget ? 'grid-cols-2 xl:grid-cols-4' : 'grid-cols-1'} gap-1`}>
                  {totals.hasBudget ? (
                    <>
                      <SummaryValue label={t('budgetOverview.remaining')} value={fmt(totals.remaining)} emphasis negative={totals.remaining < 0} />
                      <SummaryValue label={t('budgetOverview.spent')} value={fmt(totals.actual)} />
                      <SummaryValue label={t('budgetOverview.totalBudget')} value={fmt(totals.budget)} />
                      {totals.daysRemaining > 0 && (
                        <SummaryValue label={t('budgetOverview.safeDaily')} value={fmt(totals.safeDaily)} />
                      )}
                    </>
                  ) : (
                    <SummaryValue label={t('budgetOverview.spent')} value={fmt(totals.actual)} emphasis />
                  )}
                </div>
                {totals.hasBudget && (
                  <div className="mt-2 px-3 pb-3 sm:px-4" aria-label={t('budgetOverview.budgetUsed')}>
                    <div className="mb-2 flex justify-between gap-3 text-xs">
                      <span className="text-muted-foreground">{t('budgetOverview.budgetUsed')}</span>
                      <span className="font-medium tabular-nums">{Math.round((totals.actual / totals.budget) * 100)}%</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={t('budgetOverview.budgetUsed')}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, Math.max(0, (totals.actual / totals.budget) * 100))}
                      className="h-2 overflow-hidden rounded-full bg-muted"
                    >
                      <div
                        className={`h-full rounded-full transition-[width] ${totals.actual / totals.budget > 0.8 ? 'bg-amber-500' : 'bg-primary'}`}
                        style={{ width: `${Math.min(100, Math.max(0, (totals.actual / totals.budget) * 100))}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)] gap-5">
            {(totals.hasBudget || totals.hasActivity) && (
              <Card title={t('budgetOverview.pace')}>
                <div className="h-[250px] sm:h-[300px] px-2 sm:px-4 pb-3 pt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="budget-actual-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" strokeOpacity={0.55} />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
                    <YAxis width={68} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} tickFormatter={(value: number) => compactCurrency(value, currency, locale)} />
                    <ChartTooltip
                      formatter={(value, name) => [fmt(Number(value)), name === 'actual' ? t('budgetOverview.spent') : name === 'planned' ? t('budgetOverview.projected') : t('budgetOverview.totalBudget')]}
                      labelFormatter={(day) => t('budgetOverview.dayOfMonth', { day })}
                      contentStyle={{ background: 'var(--popover)', borderColor: 'var(--border)', borderRadius: 12, color: 'var(--popover-foreground)' }}
                    />
                    {totals.budget > 0 && <ReferenceLine y={totals.budget} stroke="var(--muted-foreground)" strokeDasharray="5 5" />}
                    <Area type="monotone" dataKey="actual" connectNulls={false} stroke="var(--primary)" strokeWidth={2.5} fill="url(#budget-actual-fill)" dot={false} activeDot={{ r: 4 }} />
                    <Area type="monotone" dataKey="planned" connectNulls={false} stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="5 4" fill="none" dot={false} activeDot={{ r: 4 }} />
                  </AreaChart>
                </ResponsiveContainer>
                </div>
                <div className="px-5 pb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                  <span><span className="inline-block size-2 rounded-full bg-primary mr-2" />{t('budgetOverview.actualToDate')}</span>
                  <span><span className="inline-block size-2 rounded-full bg-[var(--chart-2)] mr-2" />{t('budgetOverview.plannedTransactions')}</span>
                  {totals.hasBudget && <span><span className="inline-block w-4 border-t border-dashed border-muted-foreground mr-2 align-middle" />{t('budgetOverview.totalBudget')}</span>}
                </div>
              </Card>
            )}

            <div className={`${totals.hasBudget || totals.hasActivity ? 'space-y-5' : 'xl:col-span-2'}`}>
              {(totals.hasBudget || totals.hasActivity) && (
                <Card title={t('budgetOverview.monthlyPace')}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 sm:p-5">
                    {totals.expectedAtPace !== null && (
                      <MetricCard
                        label={t('budgetOverview.expectedAtPace')}
                        value={fmt(totals.expectedAtPace)}
                        note={t('budgetOverview.paceEstimateHint')}
                      />
                    )}
                    <MetricCard
                      label={t('budgetOverview.monthEndEstimate')}
                      value={fmt(totals.projected)}
                      note={t('budgetOverview.transactionForecastHint')}
                      accent={totals.expectedAtPace === null}
                    />
                  </div>
                </Card>
              )}

              <Card title={t('budgetOverview.history')}>
                <div className="p-4 sm:p-5">
                  {historyLoading ? (
                    <Skeleton className="h-24 w-full rounded-lg" />
                  ) : historyError ? (
                    <div className="flex items-center justify-between gap-3 text-sm text-destructive">
                      <span>{t('reports.loadError')}</span>
                      <button type="button" onClick={() => { void refetchHistory() }} className="shrink-0 font-semibold hover:underline">{t('common.retry')}</button>
                    </div>
                  ) : historyMonths.length ? (
                    <>
                      {previousMonth && previousMonth.budget > 0 && (
                        <div className="mb-4 rounded-lg bg-muted/50 px-3 py-2.5">
                          <p className="text-xs text-muted-foreground">{t('budgetOverview.previousMonth')}</p>
                          <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                            {t('budgetOverview.previousMonthSummary', {
                              month: monthLabel(previousMonth.month, i18n.resolvedLanguage ?? i18n.language),
                              spent: fmt(previousMonth.actual),
                              budget: fmt(previousMonth.budget),
                              remaining: fmt(previousMonth.remaining),
                            })}
                          </p>
                        </div>
                      )}
                      <div className="grid grid-cols-6 gap-2">
                        {historyMonths.map((item) => (
                          <div key={item.month} className="text-center">
                            <button
                              type="button"
                              title={monthLabel(item.month, i18n.resolvedLanguage ?? i18n.language)}
                              aria-label={`${monthLabel(item.month, i18n.resolvedLanguage ?? i18n.language)}: ${item.budget > 0 ? `${fmt(item.actual)} / ${fmt(item.budget)}` : t('budgetOverview.noBudgetSet')}`}
                              onClick={() => setMonthOverride(item.month)}
                              className={`mx-auto flex size-9 items-center justify-center rounded-full text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${item.budget > 0 ? item.underBudget ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
                            >{item.budget > 0 ? item.underBudget ? '✓' : '!' : '·'}</button>
                            <p className="mt-2 text-[10px] uppercase text-muted-foreground">{monthLabel(item.month, i18n.resolvedLanguage ?? i18n.language).slice(0, 3)}</p>
                          </div>
                        ))}
                      </div>
                      <p className="mt-4 text-xs text-muted-foreground">
                        {historySummary.budgetedMonths > 0
                          ? t('budgetOverview.monthsUnderBudget', { count: historySummary.underBudgetMonths, total: historySummary.budgetedMonths })
                          : t('budgetOverview.noHistory')}
                      </p>
                    </>
                  ) : <p className="text-sm text-muted-foreground">{t('budgetOverview.noHistory')}</p>}
                </div>
              </Card>
            </div>
          </div>

          <Card
            title={t('budgetOverview.categoryBudgets')}
            action={<span className="text-xs text-muted-foreground">{t('budgetOverview.categoriesCount', { count: rows.filter((row) => row.budget_amount != null && row.budget_amount > 0).length })}</span>}
          >
            {sortedRows.length ? (
              <div className="divide-y divide-border">
                {sortedRows.map((row) => {
                  const hasBudget = row.budget_amount != null && row.budget_amount > 0
                  const percent = hasBudget ? row.actual_amount / row.budget_amount! * 100 : 0
                  const over = hasBudget && percent > 100
                  const near = hasBudget && percent >= 80 && !over
                  const barColor = over ? 'bg-rose-500' : near ? 'bg-amber-500' : 'bg-primary'
                  return (
                    <Link
                      key={row.category_id}
                      to={`/transactions?category_id=${encodeURIComponent(row.category_id)}&from=${monthRange(month).from}&to=${monthRange(month).to}`}
                      aria-label={`${t('budgetOverview.viewTransactionsFor', { category: row.category_name })} · ${monthTitle}`}
                      className="block px-4 py-3.5 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5"
                    >
                    <div className="flex items-center gap-3 sm:gap-4">
                      <CategoryIcon icon={row.category_icon} color={row.category_color} size="lg" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{row.category_name}</p>
                            {row.group_name && <p className="text-[11px] text-muted-foreground truncate">{row.group_name}</p>}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-semibold tabular-nums text-foreground">{fmt(row.actual_amount)}</p>
                            <p className="text-[11px] text-muted-foreground">{hasBudget ? t('budgetOverview.ofBudget', { amount: fmt(row.budget_amount!) }) : t('budgetOverview.noBudgetSet')}</p>
                          </div>
                        </div>
                        {hasBudget && (
                          <div className="flex items-center gap-3">
                            <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden"><div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, percent)}%` }} /></div>
                            <span className={`w-12 text-right text-[11px] font-medium tabular-nums ${over ? 'text-rose-500' : near ? 'text-amber-500' : 'text-muted-foreground'}`}>{Math.round(percent)}%</span>
                            <span className="hidden sm:block w-24 text-right text-[11px] tabular-nums text-muted-foreground">{fmt(row.budget_amount! - row.actual_amount)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <div className="py-12 text-center px-6">
                <p className="text-sm text-muted-foreground">{t('budgetOverview.noData')}</p>
                <Button asChild variant="outline" size="sm" className="mt-4"><Link to={`/budgets?month=${month}`}>{t('budgetOverview.setBudgets')}</Link></Button>
              </div>
            )}
            {totals.unbudgeted > 0 && (
              <div className="border-t border-border px-4 sm:px-5 py-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                <span>{t('budgetOverview.unbudgetedSpending')}</span><span className="font-medium tabular-nums text-foreground">{fmt(totals.unbudgeted)}</span>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
