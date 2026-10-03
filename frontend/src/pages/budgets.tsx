import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { useDisplayLocale } from '@/hooks/use-display-locale'
import { monthLabel, shiftMonth } from '@/lib/month-utils'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { categories as categoriesApi, categoryGroups as groupsApi, budgets as budgetsApi } from '@/lib/api'
import { extractApiError } from '@/lib/api-errors'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import type { Budget } from '@/types'
import { Pencil, Trash2, Plus, Repeat, CalendarIcon, PiggyBank } from 'lucide-react'
import { format } from 'date-fns'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { MonthPicker } from '@/components/ui/monthpicker'
import { PageHeader } from '@/components/page-header'
import { CategoryIcon } from '@/components/category-icon'
import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import { useAuth } from '@/contexts/auth-context'
import { useWorkspace } from '@/contexts/workspace-context'
import { useEffectiveTimezone } from '@/hooks/use-timezone'
import { resolveDateFnsLocale } from '@/lib/date-fns-locale'
import { findCategoryReference } from '@/lib/category-reference-utils'
import { averageActualForCategory } from '@/lib/budget-overview-utils'
import { todayInTimezone } from '@/lib/date-utils'
import { formatCurrency } from '@/lib/format'

const TH = 'text-xs font-medium text-muted-foreground py-3'

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      {children}
    </div>
  )
}
function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="px-4 sm:px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {action}
    </div>
  )
}

export default function BudgetsPage() {
  const { t, i18n } = useTranslation()
  const { mask } = usePrivacyMode()
  const { user } = useAuth()
  const { canWrite } = useWorkspace()
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
  const dateFnsLocale = resolveDateFnsLocale(i18n.resolvedLanguage ?? i18n.language)
  const monthParam = `${selectedMonth}-01`
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Budget | null>(null)
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [amountDraft, setAmountDraft] = useState('')
  const [deletingBudget, setDeletingBudget] = useState<Budget | null>(null)

  const { data: budgetsList } = useQuery({
    queryKey: ['budgets', selectedMonth],
    queryFn: () => budgetsApi.list(monthParam),
  })

  const { data: categoriesList } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.list,
  })

  // Budgets can point at a hidden default category. The picker below only
  // offers visible ones, but existing rows still have to name what they budget.
  const { data: allCategoriesList } = useQuery({
    queryKey: ['categories', 'management'],
    queryFn: categoriesApi.listIncludingHidden,
  })

  const { data: groupsList } = useQuery({
    queryKey: ['category-groups'],
    queryFn: groupsApi.list,
  })

  const suggestionMonths = useMemo(
    () => [-1, -2, -3].map((offset) => `${shiftMonth(selectedMonth, offset)}-01`),
    [selectedMonth],
  )
  const { data: suggestionComparisons, isLoading: suggestionsLoading } = useQuery({
    queryKey: ['budgets', 'three-month-average', selectedMonth],
    queryFn: () => Promise.all(suggestionMonths.map((month) => budgetsApi.comparison(month))),
    enabled: dialogOpen && !editing,
    staleTime: 5 * 60 * 1000,
  })
  const suggestedAmount = useMemo(
    () => selectedCategoryId && suggestionComparisons
      ? averageActualForCategory(suggestionComparisons, selectedCategoryId)
      : 0,
    [selectedCategoryId, suggestionComparisons],
  )

  const createMutation = useMutation({
    mutationFn: (data: { category_id: string; amount: number; month: string; is_recurring?: boolean }) =>
      budgetsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] })
      setDialogOpen(false)
      toast.success(t('budgets.created'))
    },
    onError: () => toast.error(t('common.error')),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) =>
      budgetsApi.update(id, { amount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] })
      setDialogOpen(false)
      setEditing(null)
      toast.success(t('budgets.updated'))
    },
    onError: () => toast.error(t('common.error')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => budgetsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] })
      setDeletingBudget(null)
      toast.success(t('budgets.deleted'))
    },
    onError: (err: unknown) => {
      toast.error(extractApiError(err, t('common.error')))
    },
  })

  const displayCategories = allCategoriesList ?? categoriesList ?? []

  const closeBudgetDialog = () => {
    setDialogOpen(false)
    setEditing(null)
    setSelectedCategoryId('')
    setAmountDraft('')
  }

  const getCategoryDisplay = (categoryId: string) => {
    const category = findCategoryReference(displayCategories, categoryId)
    if (!category) return <span>{categoryId}</span>
    return (
      <span className="flex items-center gap-2">
        <CategoryIcon icon={category.icon} color={category.color} size="sm" />
        <span>{category.name}</span>
      </span>
    )
  }

  const uiLocale = i18n.resolvedLanguage ?? i18n.language
  const monthTitle = monthLabel(selectedMonth, uiLocale).replace(/^\w/, c => c.toUpperCase())

  return (
    <div>
      <PageHeader
        section={t('nav.groupSetup')}
        title={t('budgets.settingsTitle')}
        action={
          <div className="flex flex-wrap items-center gap-1">
            <button
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:border-border hover:text-foreground transition-all text-base"
              onClick={() => {
                setMonthOverride((value) => shiftMonth(value ?? selectedMonth, -1))
              }}
            >‹</button>
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
            <button
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:border-border hover:text-foreground transition-all text-base"
              onClick={() => {
                setMonthOverride((value) => shiftMonth(value ?? selectedMonth, 1))
              }}
            >›</button>
            <Button asChild variant="outline" size="sm" className="ml-2 gap-1.5">
              <Link to={`/budget?month=${selectedMonth}`}><PiggyBank size={14} />{t('nav.budget')}</Link>
            </Button>
          </div>
        }
      />

      <SectionCard>
        <SectionHeader
          title={t('budgets.settingsTitle')}
          action={
            canWrite ? (
              <Button size="sm" className="gap-1.5 h-8" onClick={() => { setEditing(null); setSelectedCategoryId(''); setAmountDraft(''); setDialogOpen(true) }}>
                <Plus size={13} /> {t('budgets.add')}
              </Button>
            ) : undefined
          }
        />
        {budgetsList && budgetsList.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className={`${TH} pl-4 sm:pl-5 text-left`}>{t('budgets.category')}</th>
                <th className={`${TH} text-left w-36`}>{t('budgets.amount')}</th>
                {canWrite && <th className={`${TH} pr-4 sm:pr-5 text-right w-24`}>{t('budgets.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {budgetsList.map((budget) => (
                <tr key={budget.id} className="border-b border-border last:border-0 hover:bg-muted transition-colors">
                  <td className="py-3 pl-4 sm:pl-5 text-sm font-medium text-foreground">
                    <span className="flex items-center gap-1.5">
                      {getCategoryDisplay(budget.category_id)}
                      {budget.is_recurring && (
                        <span title={t('budgets.recurringLabel')} className="text-muted-foreground">
                          <Repeat size={12} />
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-3 text-sm font-semibold tabular-nums text-foreground">{mask(formatCurrency(budget.amount, userCurrency, locale))}</td>
                  {canWrite && (
                    <td className="py-3 pr-4 sm:pr-5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors"
                          onClick={() => { setEditing(budget); setSelectedCategoryId(budget.category_id); setAmountDraft(budget.amount.toString()); setDialogOpen(true) }}
                          aria-label={t('common.edit')}
                          title={t('common.edit')}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          className="p-1.5 rounded-md text-muted-foreground hover:text-rose-500 hover:bg-rose-50 transition-colors"
                          onClick={() => setDeletingBudget(budget)}
                          disabled={deleteMutation.isPending}
                          aria-label={t('common.delete')}
                          title={t('common.delete')}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-10">{t('budgets.empty')}</p>
        )}
      </SectionCard>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (open) setDialogOpen(true); else closeBudgetDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('budgets.edit') : t('budgets.add')}</DialogTitle>
          </DialogHeader>
          <form
            key={editing?.id ?? 'new'}
            onSubmit={(e) => {
              e.preventDefault()
              if (editing) {
                updateMutation.mutate({
                  id: editing.id,
                  amount: Number(amountDraft),
                })
              } else {
                const formData = new FormData(e.currentTarget)
                const isRecurring = formData.get('is_recurring') === 'on'
                createMutation.mutate({
                  category_id: selectedCategoryId,
                  amount: Number(amountDraft),
                  month: monthParam,
                  is_recurring: isRecurring,
                })
              }
            }}
            className="space-y-4"
          >
            {!editing && (
              <>
                <div className="space-y-2">
                  <Label>{t('budgets.category')}</Label>
                  <select
                    name="category_id"
                    value={selectedCategoryId}
                    onChange={(event) => setSelectedCategoryId(event.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  >
                    <option value="">{t('budgets.selectCategory')}</option>
                    {groupsList?.map((group) => (
                      <optgroup key={group.id} label={group.name}>
                        {group.categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                      </optgroup>
                    ))}
                    {categoriesList?.filter((c) => !c.group_id).map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" name="is_recurring" className="rounded border-border" />
                  <span className="text-sm text-foreground">{t('budgets.repeatEveryMonth')}</span>
                </label>
              </>
            )}
            <div className="space-y-2">
              <Label>{t('budgets.amount')}</Label>
              <Input
                name="amount"
                type="number"
                min="0"
                step="0.01"
                value={amountDraft}
                onChange={(event) => setAmountDraft(event.target.value)}
                required
              />
            </div>
            {!editing && selectedCategoryId && (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                {suggestionsLoading ? (
                  <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
                ) : suggestedAmount > 0 ? (
                  <Button type="button" variant="ghost" size="sm" className="h-auto w-full justify-start px-1 py-0.5 text-left" onClick={() => setAmountDraft(suggestedAmount.toFixed(2))}>
                    {t('budgets.averageLastThreeMonths', { amount: mask(formatCurrency(suggestedAmount, userCurrency, locale)) })}
                    <span className="ml-auto text-primary">{t('budgets.useAverage')}</span>
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('budgets.noAverageAvailable')}</p>
                )}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeBudgetDialog}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={!!deletingBudget}
        title={t('budgets.confirmDeleteTitle')}
        description={t(
          deletingBudget?.is_recurring
            ? 'budgets.confirmDeleteRecurringDescription'
            : 'budgets.confirmDeleteDescription',
          {
            name: findCategoryReference(displayCategories, deletingBudget?.category_id ?? '')?.name
              ?? t('budgets.category'),
          },
        )}
        isPending={deleteMutation.isPending}
        onClose={() => setDeletingBudget(null)}
        onConfirm={() => deletingBudget && deleteMutation.mutate(deletingBudget.id)}
      />
    </div>
  )
}
