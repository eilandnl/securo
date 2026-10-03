import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowDownRight, ArrowUpRight, CalendarIcon, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react'
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
import { budgets, transactions } from '@/lib/api'
import { buildBudgetPaceSeries, sortBudgetCategories, summarizeBudgetMonth } from '@/lib/budget-overview-utils'
import { resolveDateFnsLocale } from '@/lib/date-fns-locale'
import { formatCurrency } from '@/lib/format'
import { currentMonth, monthLabel, shiftMonth } from '@/lib/month-utils'

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
  const currency = user?.preferences?.currency_display ?? 'USD'
  const [month, setMonth] = useState(currentMonth)
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const monthParam = `${month}-01`
  const dateFnsLocale = resolveDateFnsLocale(i18n.resolvedLanguage ?? i18n.language)
  const monthTitle = monthLabel(month, i18n.resolvedLanguage ?? i18n.language)
    .replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase(i18n.resolvedLanguage ?? i18n.language))

  const { data: comparison, isLoading: comparisonLoading } = useQuery({
    queryKey: ['budgets', 'comparison', month],
    queryFn: () => budgets.comparison(monthParam),
  })
  const { data: calendar, isLoading: calendarLoading } = useQuery({
    queryKey: ['transactions', 'calendar', month],
    queryFn: () => transactions.calendar({ month: monthParam }),
  })
  const { data: history } = useQuery({
    queryKey: ['budgets', 'history', month],
    queryFn: async () => Promise.all(
      Array.from({ length: 6 }, (_, index) => shiftMonth(month, -(index + 1)))
        .map((historyMonth) => budgets.comparison(`${historyMonth}-01`)),
    ),
  })

  const rows = useMemo(() => comparison ?? [], [comparison])
  const totals = useMemo(() => summarizeBudgetMonth(rows, month), [rows, month])
  const sortedRows = useMemo(() => sortBudgetCategories(rows), [rows])
  const chartData = useMemo(
    () => buildBudgetPaceSeries(calendar, month, totals.budget, totals.projected),
    [calendar, month, totals.budget, totals.projected],
  )
  const historyMonths = (history ?? []).map((historyRows, index) => {
    const historyMonth = shiftMonth(month, -(index + 1))
    const historyTotals = summarizeBudgetMonth(historyRows, historyMonth)
    return { month: historyMonth, ...historyTotals, underBudget: historyTotals.budget > 0 && historyTotals.actual <= historyTotals.budget }
  }).reverse()
  const underBudgetCount = historyMonths.filter((item) => item.underBudget).length
  const loading = comparisonLoading || calendarLoading

  const fmt = (amount: number) => mask(formatCurrency(amount, currency, locale))
  const remainingPositive = totals.remaining >= 0
  const paceMessage = totals.budget === 0
    ? t('budgetOverview.noBudget')
    : totals.paceDelta >= 0
      ? t('budgetOverview.belowPace', { amount: fmt(totals.paceDelta) })
      : t('budgetOverview.abovePace', { amount: fmt(Math.abs(totals.paceDelta)) })

  return (
    <div className="space-y-5">
      <PageHeader
        section={t('nav.groupAnalysis')}
        title={t('nav.budget')}
        action={(
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label={t('dashboard.monthPrevious')} onClick={() => setMonth((value) => shiftMonth(value, -1))}>
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
                    setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
                    setMonthPickerOpen(false)
                  }}
                />
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="icon" aria-label={t('dashboard.monthNext')} onClick={() => setMonth((value) => shiftMonth(value, 1))}>
              <ChevronRight className="size-4" />
            </Button>
            <Button asChild variant="outline" className="ml-2 gap-2">
              <Link to="/budgets"><Settings2 className="size-4" />{t('nav.budgetSettings')}</Link>
            </Button>
          </div>
        )}
      />

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <MetricCard
              label={t('budgetOverview.remaining')}
              value={fmt(totals.remaining)}
              note={t('budgetOverview.ofBudget', { amount: fmt(totals.budget) })}
              accent
            />
            <MetricCard label={t('budgetOverview.spent')} value={fmt(totals.actual)} note={paceMessage} />
            <MetricCard label={t('budgetOverview.expected')} value={fmt(totals.projected)} note={t('dashboard.spendingProjection', { amount: fmt(totals.projected) })} />
            <MetricCard
              label={t('budgetOverview.safeDaily')}
              value={fmt(totals.safeDaily)}
              note={remainingPositive
                ? t('budgetOverview.forDays', { count: totals.daysRemaining })
                : t('budgetOverview.overBudgetBy', { amount: fmt(Math.abs(totals.remaining)) })}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)] gap-5">
            <Card title={t('budgetOverview.pace')}>
              <div className="px-4 sm:px-5 pt-4 pb-1 flex items-center justify-between gap-4">
                <div>
                  <p className="text-3xl sm:text-4xl font-semibold tracking-tight tabular-nums">{fmt(Math.max(0, totals.remaining))}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t('budgetOverview.leftOf', { budget: fmt(totals.budget) })}</p>
                </div>
                <div className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${totals.paceDelta >= 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
                  {totals.paceDelta >= 0 ? <ArrowDownRight className="inline size-3.5 mr-1" /> : <ArrowUpRight className="inline size-3.5 mr-1" />}
                  {paceMessage}
                </div>
              </div>
              <div className="h-[250px] sm:h-[300px] px-2 sm:px-4 pb-3 pt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="budget-actual-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" strokeOpacity={0.55} />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} />
                    <YAxis width={58} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} tickFormatter={(value: number) => fmt(value)} />
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
                <span><span className="inline-block w-4 border-t border-dashed border-muted-foreground mr-2 align-middle" />{t('budgetOverview.totalBudget')}</span>
              </div>
            </Card>

            <div className="space-y-5">
              <Card title={t('budgetOverview.monthlyPace')}>
                <div className="p-4 sm:p-5 space-y-4">
                  <div>
                    <div className="flex justify-between text-xs mb-2"><span className="text-muted-foreground">{t('budgetOverview.monthElapsed')}</span><span className="font-medium">{Math.round((totals.daysElapsed / Math.max(1, chartData.length)) * 100)}%</span></div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-muted-foreground/50 rounded-full" style={{ width: `${Math.min(100, (totals.daysElapsed / Math.max(1, chartData.length)) * 100)}%` }} /></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-2"><span className="text-muted-foreground">{t('budgetOverview.budgetUsed')}</span><span className="font-medium">{totals.budget > 0 ? Math.round((totals.actual / totals.budget) * 100) : 0}%</span></div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden"><div className={`h-full rounded-full ${totals.budget > 0 && totals.actual / totals.budget > 0.8 ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${totals.budget > 0 ? Math.min(100, (totals.actual / totals.budget) * 100) : 0}%` }} /></div>
                  </div>
                  <div className="border-t border-border pt-4 grid grid-cols-2 gap-4">
                    <div><p className="text-xs text-muted-foreground">{t('budgetOverview.expectedAtPace')}</p><p className="mt-1 font-semibold tabular-nums">{fmt(totals.expectedAtPace)}</p></div>
                    <div><p className="text-xs text-muted-foreground">{t('budgetOverview.monthEndEstimate')}</p><p className="mt-1 font-semibold tabular-nums">{fmt(totals.projected)}</p></div>
                  </div>
                </div>
              </Card>

              <Card title={t('budgetOverview.history')}>
                <div className="p-4 sm:p-5">
                  {historyMonths.length ? (
                    <>
                      <div className="grid grid-cols-6 gap-2">
                        {historyMonths.map((item) => (
                          <div key={item.month} className="text-center">
                            <div className={`mx-auto size-9 rounded-full flex items-center justify-center text-sm ${item.budget > 0 ? item.underBudget ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground'}`}>
                              {item.budget > 0 ? item.underBudget ? '✓' : '!' : '·'}
                            </div>
                            <p className="mt-2 text-[10px] uppercase text-muted-foreground">{monthLabel(item.month, i18n.resolvedLanguage ?? i18n.language).slice(0, 3)}</p>
                          </div>
                        ))}
                      </div>
                      <p className="mt-4 text-xs text-muted-foreground">{t('budgetOverview.monthsUnderBudget', { count: underBudgetCount, total: historyMonths.length })}</p>
                    </>
                  ) : <p className="text-sm text-muted-foreground">{t('budgetOverview.noHistory')}</p>}
                </div>
              </Card>
            </div>
          </div>

          <Card
            title={t('budgetOverview.categoryBudgets')}
            action={<span className="text-xs text-muted-foreground">{t('budgetOverview.categoriesCount', { count: rows.filter((row) => row.budget_amount != null).length })}</span>}
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
                    <div key={row.category_id} className="px-4 sm:px-5 py-3.5 flex items-center gap-3 sm:gap-4 hover:bg-muted/30 transition-colors">
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
                  )
                })}
              </div>
            ) : (
              <div className="py-12 text-center px-6">
                <p className="text-sm text-muted-foreground">{t('budgetOverview.noData')}</p>
                <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/budgets">{t('budgetOverview.setBudgets')}</Link></Button>
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
