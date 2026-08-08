'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'

import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Icons } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

type ReviewStatus = 'pending' | 'held' | 'approved' | 'modified' | 'rejected' | 'resumed'
type Decision = 'approve' | 'modify' | 'reject' | 'hold'

type WorkbenchItem = {
  id: number
  agent_run_id: number
  reason: string
  status: ReviewStatus
  decision_notes: string | null
  assigned_to: string | null
  created_at: string
  resolved_at: string | null
  agent_run_status: string
  supervity_run_id: string | null
  review_source: string | null
  review_url: string | null
  review_context: {
    form_data: Record<string, unknown>
    recommendation_activities: Array<{
      step_id?: string
      step_name?: string
      description?: string
      outputs?: Record<string, unknown>
    }>
  }
  disruption_id: number
  external_id: string
  disruption: {
    item_number: string | null
    notice_supplier_id: string | null
    notice_type: string | null
    notice_id: string
  }
}

type WorkbenchResponse = { items: WorkbenchItem[] }
type DecisionResponse = {
  status: ReviewStatus
  workbench_item_id: number
  resume_required: boolean
}
type StatusFilter = 'pending' | 'held' | 'approved' | 'modified' | 'rejected' | 'all'

const filters: Array<{ value: StatusFilter; label: string }> = [
  { value: 'pending', label: 'Needs review' },
  { value: 'held', label: 'Held' },
  { value: 'approved', label: 'Approved' },
  { value: 'modified', label: 'Modified' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
]

function formatStatus(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function statusClasses(status: string) {
  if (status === 'approved' || status === 'resumed') return 'bg-emerald-100 text-emerald-700'
  if (status === 'rejected') return 'bg-red-100 text-red-700'
  if (status === 'held') return 'bg-purple-100 text-purple-700'
  if (status === 'modified') return 'bg-blue-100 text-blue-700'
  return 'bg-amber-100 text-amber-800'
}

type Strategy = { type?: string; name?: string; description?: string; rank_score?: number }
type Recommendation = {
  recommended_strategy?: string
  options?: Strategy[]
  impact_mapper?: Record<string, unknown>
  alternative_sourcing?: Record<string, unknown>
  expedite_compliance?: Record<string, unknown>
}

function humanize(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch { return null }
}

function extractRecommendation(item: WorkbenchItem): Recommendation | null {
  const activities = item.review_context?.recommendation_activities ?? []
  for (const activity of [...activities].reverse()) {
    const outputs = parseObject(activity.outputs)
    const candidate = parseObject(outputs?.output) ?? outputs
    if (candidate && (candidate.recommended_strategy || Array.isArray(candidate.options) || candidate.impact_mapper)) return candidate as Recommendation
  }
  const form = parseObject(item.review_context?.form_data)
  return form && (form.recommended_strategy || Array.isArray(form.options)) ? form as Recommendation : null
}

function displayValue(value: unknown, fallback = 'Not available') {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function money(value: unknown) {
  const amount = Number(value)
  return Number.isFinite(amount) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount) : 'Not available'
}

function queueMetrics(item: WorkbenchItem) {
  const recommendation = extractRecommendation(item)
  const impact = recommendation?.impact_mapper ?? {}
  const severity = String(impact.severity || 'unknown').toLowerCase()
  const exposureValue = Number(impact.exposure_value)
  const daysValue = Number(impact.days_until_impact)
  return {
    severity,
    exposure: Number.isFinite(exposureValue) ? exposureValue : null,
    days: Number.isFinite(daysValue) ? daysValue : null,
    recommendation: recommendation?.recommended_strategy || 'No recommendation',
  }
}

function recordAge(createdAt: string, status: ReviewStatus) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000))
  const suffix = status === 'pending' ? 'waiting' : status === 'held' ? 'held' : 'ago'
  if (minutes < 60) return `${minutes}m ${suffix}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m ${suffix}`
  return `${Math.floor(hours / 24)}d ${hours % 24}h ${suffix}`
}

function impactTime(days: number | null) {
  if (days === null) return 'Impact unknown'
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return 'Impact today'
  return `${days}d to impact`
}

function urgencyScore(item: WorkbenchItem) {
  const metrics = queueMetrics(item)
  const severityScore = ({ critical: 400, high: 300, medium: 200, low: 100 } as Record<string, number>)[metrics.severity] ?? 0
  const overdueScore = metrics.days === null ? 0 : metrics.days <= 0 ? 500 + Math.abs(metrics.days) : Math.max(0, 100 - metrics.days)
  const exposureScore = metrics.exposure ? Math.min(300, Math.log10(Math.max(1, metrics.exposure)) * 35) : 0
  const ageScore = Math.max(0, (Date.now() - new Date(item.created_at).getTime()) / 3_600_000)
  return severityScore + overdueScore + exposureScore + ageScore
}

function RecommendationBrief({ item }: { item: WorkbenchItem }) {
  const recommendation = extractRecommendation(item)
  const impact = recommendation?.impact_mapper ?? {}
  const sourcing = recommendation?.alternative_sourcing ?? {}
  const compliance = recommendation?.expedite_compliance ?? {}
  const recommended = recommendation?.recommended_strategy
  const options = [...(recommendation?.options ?? [])].sort((a, b) => (a.rank_score ?? 999) - (b.rank_score ?? 999))
  const selectedOption = options.find((option) => option.name === recommended)
  const statusTone = (value: unknown) => String(value).toLowerCase() === 'resolved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'

  return (
    <section className='space-y-5 rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/80 to-white p-5'>
      <div className='flex items-start gap-3'>
        <div className='rounded-lg bg-indigo-100 p-2 text-indigo-700'><Icons.lightbulb className='h-5 w-5' /></div>
        <div><p className='text-lg font-semibold text-brand-navy'>Decision brief</p><p className='mt-1 text-sm text-muted-foreground'>Recommended action, ranked alternatives, business impact, and operational constraints.</p></div>
      </div>

      {recommendation ? <>
        <div className='rounded-xl border border-emerald-200 bg-emerald-50 p-5'>
          <p className='text-xs font-bold uppercase tracking-wider text-emerald-700'>Recommended recovery action</p>
          <div className='mt-2 flex flex-wrap items-center justify-between gap-3'><p className='text-2xl font-bold text-emerald-950'>{displayValue(recommended)}</p><span className='rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white'>ORCHESTRATOR CHOICE</span></div>
          {selectedOption?.description && <p className='mt-3 max-w-3xl text-sm leading-6 text-emerald-900'>{selectedOption.description}</p>}
        </div>

        <div><p className='mb-3 text-xs font-bold uppercase tracking-wider text-indigo-700'>Business impact</p><div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
          {[
            ['Severity', displayValue(impact.severity)],
            ['Financial exposure', money(impact.exposure_value)],
            ['Time to impact', impactTime(Number.isFinite(Number(impact.days_until_impact)) ? Number(impact.days_until_impact) : null)],
            ['Assessment', displayValue(impact.status)],
          ].map(([label, value]) => <div key={label} className='rounded-lg border bg-white p-3'><p className='text-[11px] font-semibold uppercase tracking-wide text-brand-muted'>{label}</p><p className='mt-1 text-base font-semibold text-brand-navy'>{value}</p></div>)}
        </div></div>

        <div><p className='mb-3 text-xs font-bold uppercase tracking-wider text-indigo-700'>Recovery options</p><div className='overflow-hidden rounded-xl border bg-white'>
          {options.map((option, index) => <div key={`${option.name}-${index}`} className={cn('grid gap-3 border-b p-4 last:border-b-0 sm:grid-cols-[40px_minmax(160px,0.65fr)_1fr_auto] sm:items-center', option.name === recommended && 'bg-emerald-50/70')}>
            <span className='flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-brand-navy'>{index + 1}</span>
            <div><p className='font-semibold text-brand-navy'>{displayValue(option.name)}</p><p className='mt-0.5 text-xs text-muted-foreground'>{humanize(option.type ?? 'Recovery option')}</p></div>
            <p className='text-sm leading-5 text-slate-600'>{displayValue(option.description)}</p>
            <div className='text-right'>{option.name === recommended && <span className='block text-xs font-bold text-emerald-700'>RECOMMENDED</span>}<span className='text-xs text-muted-foreground'>Score {displayValue(option.rank_score)}</span></div>
          </div>)}
        </div></div>

        <div><p className='mb-3 text-xs font-bold uppercase tracking-wider text-indigo-700'>Feasibility and constraints</p><div className='grid gap-3 md:grid-cols-3'>
          {[
            ['Impact assessment', impact.status, impact.summary],
            ['Alternative sourcing', sourcing.status, sourcing.reason],
            ['Expedite compliance', compliance.status, compliance.reason],
          ].map(([label, status, explanation]) => <div key={String(label)} className='rounded-lg border bg-white p-4'><div className='flex items-center justify-between gap-2'><p className='font-semibold text-brand-navy'>{String(label)}</p><span className={cn('rounded-full px-2 py-1 text-[10px] font-bold uppercase', statusTone(status))}>{displayValue(status, 'Unknown')}</span></div><p className='mt-3 text-sm leading-5 text-slate-600'>{displayValue(explanation)}</p></div>)}
        </div></div>
      </> : <p className='rounded-lg border border-dashed bg-white/70 p-4 text-sm text-muted-foreground'>This earlier run did not persist a structured recommendation. New human-decision runs will show the recommendation, alternatives, impact, and constraints here.</p>}
    </section>
  )
}

export default function WorkbenchPage() {
  const [items, setItems] = useState<WorkbenchItem[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null
    const value = Number(new URLSearchParams(window.location.search).get('review'))
    return Number.isInteger(value) && value > 0 ? value : null
  })
  const [filter, setFilter] = useState<StatusFilter>('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState<Decision | 'resume' | null>(null)
  const [notes, setNotes] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [assignmentFilter, setAssignmentFilter] = useState('all')
  const [ageFilter, setAgeFilter] = useState('all')
  const [exposureFilter, setExposureFilter] = useState('all')
  const [sortBy, setSortBy] = useState('urgency')

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId]
  )
  const selectedRecommendation = useMemo(() => selected ? extractRecommendation(selected) : null, [selected])
  const recoveryOptions = selectedRecommendation?.options ?? []
  const queueItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const now = Date.now()
    const filtered = items.filter(item => {
      const metrics = queueMetrics(item)
      const searchable = [item.disruption.item_number, item.disruption.notice_supplier_id, item.external_id, item.agent_run_id, metrics.recommendation].join(' ').toLowerCase()
      const ageHours = Math.max(0, (now - new Date(item.created_at).getTime()) / 3_600_000)
      if (query && !searchable.includes(query)) return false
      if (severityFilter !== 'all' && metrics.severity !== severityFilter) return false
      if (assignmentFilter === 'assigned' && !item.assigned_to) return false
      if (assignmentFilter === 'unassigned' && item.assigned_to) return false
      if (ageFilter === 'over1h' && ageHours < 1) return false
      if (ageFilter === 'over4h' && ageHours < 4) return false
      if (ageFilter === 'over24h' && ageHours < 24) return false
      if (exposureFilter === 'over100k' && (metrics.exposure ?? 0) < 100_000) return false
      if (exposureFilter === 'over1m' && (metrics.exposure ?? 0) < 1_000_000) return false
      if (exposureFilter === 'over10m' && (metrics.exposure ?? 0) < 10_000_000) return false
      return true
    })
    return filtered.sort((a, b) => {
      if (sortBy === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      if (sortBy === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      if (sortBy === 'exposure') return (queueMetrics(b).exposure ?? -1) - (queueMetrics(a).exposure ?? -1)
      return urgencyScore(b) - urgencyScore(a)
    })
  }, [items, searchQuery, severityFilter, assignmentFilter, ageFilter, exposureFilter, sortBy])

  const hasQueueFilters = Boolean(searchQuery) || severityFilter !== 'all' || assignmentFilter !== 'all' || ageFilter !== 'all' || exposureFilter !== 'all' || sortBy !== 'urgency'

  useEffect(() => {
    if (loading) return
    if (!queueItems.some(item => item.id === selectedId)) setSelectedId(queueItems[0]?.id ?? null)
  }, [queueItems, selectedId, loading])

  function resetQueueFilters() {
    setSearchQuery('')
    setSeverityFilter('all')
    setAssignmentFilter('all')
    setAgeFilter('all')
    setExposureFilter('all')
    setSortBy('urgency')
  }

  const loadItems = useCallback(async (nextFilter: StatusFilter = filter) => {
    try {
      setLoading(true)
      setError('')
      const query = nextFilter === 'all' ? '?status=&limit=100' : `?status=${nextFilter}&limit=100`
      const data = await apiClient.get<WorkbenchResponse>(`/api/workbench${query}`)
      setItems(data.items)
      setSelectedId((current) =>
        data.items.some((item) => item.id === current) ? current : (data.items[0]?.id ?? null)
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the review queue.')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { loadItems() }, [loadItems])

  useEffect(() => {
    if (!selected) return
    setNotes(selected.decision_notes ?? '')
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(decision: Decision, recoveryStrategy?: string) {
    if (!selected) return

    try {
      setSubmitting(decision)
      const result = await apiClient.post<DecisionResponse>(`/api/workbench/${selected.id}/decision`, {
        decision,
        decision_notes: notes.trim() || undefined,
        recovery_strategy: recoveryStrategy,
      })
      if (result.resume_required) {
        setSubmitting('resume')
        await apiClient.post(`/api/workbench/${selected.id}/resume`)
        toast.success(recoveryStrategy ? `${recoveryStrategy} selected. Workflow continued.` : 'Decision saved and workflow continued.')
      } else if (decision === 'hold') {
        toast.success('Item held. The workflow remains paused.')
      } else {
        toast.success('Request rejected and workflow stopped.')
      }
      await loadItems()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Decision could not be saved.')
    } finally {
      setSubmitting(null)
    }
  }

  async function clearQueue() {
    if (filter === 'pending' || filter === 'held' || items.length === 0) return
    const category = filter === 'all' ? 'all resolved categories' : `${filters.find(entry => entry.value === filter)?.label} category`
    if (!window.confirm(`Clear ${category} from the visible Workbench queue? Audit records will be retained.`)) return
    try {
      setLoading(true)
      const query = filter === 'all' ? '' : `?status=${filter}`
      const result = await apiClient.delete<{ cleared: number }>(`/api/workbench/queue/clear${query}`)
      toast.success(`${result.cleared} item${result.cleared === 1 ? '' : 's'} cleared.`)
      setSelectedId(null)
      await loadItems()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Queue could not be cleared.')
      setLoading(false)
    }
  }

  async function continueApprovedWorkflow() {
    if (!selected) return
    try {
      setSubmitting('resume')
      await apiClient.post(`/api/workbench/${selected.id}/resume`)
      toast.success('Approved workflow continued in Supervity.')
      await loadItems()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Workflow could not be continued.')
    } finally {
      setSubmitting(null)
    }
  }

  function selectFilter(value: StatusFilter) {
    setFilter(value)
    setSelectedId(null)
  }

  return (
    <motion.div className='space-y-6' initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <div className='mb-2 flex items-center gap-2 text-sm font-semibold text-brand-cornflower'>
            <Icons.shield className='h-4 w-4' /> Human in the loop
          </div>
          <h1 className='text-4xl font-bold tracking-tight text-brand-navy lg:text-5xl'>Approval Workbench</h1>
          <p className='mt-2 text-lg text-muted-foreground'>Review policy exceptions, adjust their context, and safely continue approved work.</p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button variant='outline' onClick={clearQueue} disabled={loading || items.length === 0 || filter === 'pending' || filter === 'held'} title={filter === 'pending' || filter === 'held' ? 'Paused workflows must be decided before they can be cleared.' : `Clear the selected ${filter} queue`}>
            <Icons.trash className='mr-2 h-4 w-4' /> Clear queue
          </Button>
          <Button variant='outline' onClick={() => loadItems()} disabled={loading}>
            <Icons.refresh className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} /> Refresh queue
          </Button>
        </div>
      </div>

      <div className='flex flex-wrap gap-2'>
        {filters.map((entry) => (
          <Button key={entry.value} size='sm' variant={filter === entry.value ? 'default' : 'outline'} onClick={() => selectFilter(entry.value)}>
            {entry.label}
          </Button>
        ))}
      </div>

      <div className='rounded-xl border border-border/70 bg-white/80 p-3 shadow-sm'>
        <div className='grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.5fr)_repeat(5,minmax(120px,1fr))_auto]'>
          <div className='relative'>
            <Icons.search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
            <input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder='Search item, supplier, notice, run or action' aria-label='Search Workbench queue' className='h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-cornflower' />
          </div>
          <select value={severityFilter} onChange={event => setSeverityFilter(event.target.value)} aria-label='Filter by severity' className='h-10 rounded-md border border-input bg-background px-3 text-sm'>
            <option value='all'>All severities</option><option value='critical'>Critical</option><option value='high'>High</option><option value='medium'>Medium</option><option value='low'>Low</option><option value='unknown'>Unknown</option>
          </select>
          <select value={assignmentFilter} onChange={event => setAssignmentFilter(event.target.value)} aria-label='Filter by assignment' className='h-10 rounded-md border border-input bg-background px-3 text-sm'>
            <option value='all'>All assignments</option><option value='assigned'>Assigned</option><option value='unassigned'>Unassigned</option>
          </select>
          <select value={ageFilter} onChange={event => setAgeFilter(event.target.value)} aria-label='Filter by age' className='h-10 rounded-md border border-input bg-background px-3 text-sm'>
            <option value='all'>Any age</option><option value='over1h'>Over 1 hour</option><option value='over4h'>Over 4 hours</option><option value='over24h'>Over 24 hours</option>
          </select>
          <select value={exposureFilter} onChange={event => setExposureFilter(event.target.value)} aria-label='Filter by exposure' className='h-10 rounded-md border border-input bg-background px-3 text-sm'>
            <option value='all'>Any exposure</option><option value='over100k'>Over $100K</option><option value='over1m'>Over $1M</option><option value='over10m'>Over $10M</option>
          </select>
          <select value={sortBy} onChange={event => setSortBy(event.target.value)} aria-label='Sort queue' className='h-10 rounded-md border border-input bg-background px-3 text-sm'>
            <option value='urgency'>Most urgent</option><option value='newest'>Newest</option><option value='oldest'>Oldest</option><option value='exposure'>Highest exposure</option>
          </select>
          <Button variant='ghost' size='sm' className='h-10' onClick={resetQueueFilters} disabled={!hasQueueFilters}><Icons.close className='mr-1.5 h-4 w-4' /> Reset</Button>
        </div>
      </div>

      {error && <div className='rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700'>{error}</div>}

      <div className='grid min-h-[560px] gap-5 lg:grid-cols-[minmax(360px,0.95fr)_minmax(0,1.4fr)]'>
        <Card className='overflow-hidden'>
          <CardHeader className='border-b bg-slate-50/70'>
            <div className='flex items-center justify-between'>
              <CardTitle className='text-lg'>{filters.find((entry) => entry.value === filter)?.label}</CardTitle>
              <span className='rounded-full bg-brand-navy px-2.5 py-1 text-xs font-bold text-white'>{queueItems.length}{queueItems.length !== items.length ? ` / ${items.length}` : ''}</span>
            </div>
          </CardHeader>
          <CardContent className='max-h-[650px] space-y-2 overflow-y-auto p-3'>
            {loading ? (
              <div className='flex items-center justify-center py-16 text-muted-foreground'><Icons.loader className='mr-2 h-5 w-5 animate-spin' /> Loading reviews...</div>
            ) : queueItems.length === 0 ? (
              <div className='px-5 py-16 text-center'>
                <Icons.checkCircle className='mx-auto h-10 w-10 text-emerald-500' />
                <p className='mt-3 font-semibold text-brand-navy'>Queue is clear</p>
                <p className='mt-1 text-sm text-muted-foreground'>{items.length ? 'No items match the current filters.' : 'There are no items in this view.'}</p>
              </div>
            ) : queueItems.map((item) => {
              const metrics = queueMetrics(item)
              const actionRequired = item.status === 'pending' || item.status === 'held'
              return (
              <button key={item.id} onClick={() => setSelectedId(item.id)} className={cn('w-full rounded-xl border p-4 text-left transition-colors', selected?.id === item.id ? 'border-brand-cornflower bg-blue-50/60 ring-1 ring-brand-cornflower' : 'hover:bg-slate-50')}>
                <div className='flex items-start justify-between gap-3'>
                  <div className='min-w-0'>
                    <div className='flex items-center gap-2'>
                      {actionRequired && <span className='h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500' title='Action required' />}
                      <p className='truncate font-semibold text-brand-navy'>{item.disruption.item_number || item.external_id}</p>
                    </div>
                    <p className='mt-1 truncate text-xs text-muted-foreground'>Supplier {item.disruption.notice_supplier_id || 'unknown'} · Notice {item.external_id}</p>
                  </div>
                  <span className={cn('shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase', statusClasses(item.status))}>{formatStatus(item.status)}</span>
                </div>
                <div className='mt-3 flex flex-wrap gap-1.5'>
                  <span className={cn('rounded-md px-2 py-1 text-[10px] font-bold uppercase', metrics.severity === 'critical' || metrics.severity === 'high' ? 'bg-red-100 text-red-700' : metrics.severity === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600')}>{metrics.severity} severity</span>
                  <span className={cn('rounded-md px-2 py-1 text-[10px] font-semibold', metrics.days !== null && metrics.days <= 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700')}>{impactTime(metrics.days)}</span>
                  <span className='rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-700'>{metrics.exposure === null ? 'Exposure unknown' : money(metrics.exposure)}</span>
                </div>
                <div className='mt-3 rounded-lg bg-white/70 px-3 py-2'>
                  <p className='text-[10px] font-semibold uppercase tracking-wide text-brand-muted'>Recommended action</p>
                  <p className='mt-0.5 truncate text-sm font-semibold text-brand-navy'>{metrics.recommendation}</p>
                </div>
                <div className='mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground'>
                  <span className='flex items-center gap-1'><Icons.clock className='h-3.5 w-3.5' />{recordAge(item.created_at, item.status)}</span>
                  <span className='truncate'><Icons.user className='mr-1 inline h-3.5 w-3.5' />{item.assigned_to || 'Unassigned'}</span>
                </div>
              </button>
            )})}
          </CardContent>
        </Card>

        <Card>
          {!selected ? (
            <CardContent className='flex min-h-[520px] flex-col items-center justify-center text-center'>
              <Icons.inbox className='h-12 w-12 text-slate-300' />
              <p className='mt-4 font-semibold text-brand-navy'>Select a review item</p>
              <p className='mt-1 text-sm text-muted-foreground'>Its context and human controls will appear here.</p>
            </CardContent>
          ) : (
            <>
              <CardHeader className='border-b'>
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div>
                    <p className='text-xs font-semibold uppercase tracking-wider text-brand-muted'>Review #{selected.id}</p>
                    <CardTitle className='mt-1 text-2xl'>{selected.disruption.item_number || 'Unidentified item'}</CardTitle>
                  </div>
                  <span className={cn('rounded-full px-3 py-1.5 text-xs font-bold', statusClasses(selected.status))}>{formatStatus(selected.status)}</span>
                </div>
              </CardHeader>
              <CardContent className='space-y-6 p-6'>
                <div className='rounded-xl border border-amber-200 bg-amber-50 p-4'>
                  <p className='flex items-center gap-2 text-sm font-semibold text-amber-900'><Icons.alertTriangle className='h-4 w-4' /> Why human review is required</p>
                  <p className='mt-2 text-sm leading-6 text-amber-800'>{selected.reason}</p>
                </div>

                <div className='grid gap-3 sm:grid-cols-2'>
                  {[
                    ['Notice ID', selected.external_id],
                    ['Supplier ID', selected.disruption.notice_supplier_id || 'Not provided'],
                    ['Notice type', selected.disruption.notice_type || 'Not provided'],
                    ['Agent run', `#${selected.agent_run_id} · ${formatStatus(selected.agent_run_status)}`],
                  ].map(([label, value]) => (
                    <div key={label} className='rounded-xl border bg-slate-50/70 p-4'>
                      <p className='text-xs font-semibold uppercase tracking-wide text-brand-muted'>{label}</p>
                      <p className='mt-1 break-words text-sm font-medium text-brand-navy'>{value}</p>
                    </div>
                  ))}
                </div>

                <RecommendationBrief item={selected} />

                {selected.status === 'pending' && (
                  <>
                    <div>
                      <Label htmlFor='decision-notes'>Reviewer notes <span className='font-normal text-muted-foreground'>(optional)</span></Label>
                      <textarea id='decision-notes' value={notes} onChange={(event) => setNotes(event.target.value)} placeholder='Explain the decision for the audit trail...' className='mt-2 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-cornflower' />
                    </div>

                    <div className='space-y-3 border-t pt-5'>
                      <div><p className='font-semibold text-brand-navy'>Choose a recovery action</p><p className='mt-1 text-sm text-muted-foreground'>Selecting an option records that strategy and continues the orchestrator.</p></div>
                      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                        {recoveryOptions.map((option) => {
                          const isRecommended = option.name === selectedRecommendation?.recommended_strategy
                          const decision: Decision = isRecommended ? 'approve' : 'modify'
                          return <Button key={option.name} variant={isRecommended ? 'default' : 'outline'} className={cn('h-auto min-h-14 justify-start px-4 py-3 text-left', isRecommended && 'bg-emerald-600 hover:bg-emerald-700')} onClick={() => decide(decision, option.name)} disabled={submitting !== null}>
                            <Icons.check className='mr-2 h-4 w-4 shrink-0' /><span><span className='block font-semibold'>{submitting === decision ? 'Processing...' : option.name}</span>{isRecommended && <span className='block text-[10px] font-medium opacity-80'>Recommended</span>}</span>
                          </Button>
                        })}
                      </div>
                      <div className='pt-1'><Button variant='outline' className='border-red-300 text-red-700 hover:bg-red-50' onClick={() => decide('reject')} disabled={submitting !== null}><Icons.close className='mr-2 h-4 w-4' />{submitting === 'reject' ? 'Rejecting...' : 'Reject request and stop workflow'}</Button></div>
                      <div className='pt-1'><Button variant='outline' className='border-purple-300 text-purple-700 hover:bg-purple-50' onClick={() => decide('hold')} disabled={submitting !== null}><Icons.clock className='mr-2 h-4 w-4' />{submitting === 'hold' ? 'Holding...' : 'Hold for later decision'}</Button></div>
                    </div>
                  </>
                )}

                {selected.status === 'held' && (
                  <div className='space-y-4 rounded-xl border border-purple-200 bg-purple-50 p-5'>
                    <div>
                      <p className='font-semibold text-purple-950'>Workflow held by human reviewer</p>
                      <p className='mt-1 text-sm text-purple-800'>No orchestration work will continue until you make a later decision.</p>
                    </div>
                    {selected.decision_notes && <p className='rounded-lg bg-white/70 p-3 text-sm text-purple-900'>{selected.decision_notes}</p>}
                    <div className='flex flex-wrap gap-3'>
                      <Button onClick={() => decide('approve')} disabled={submitting !== null}><Icons.arrowRight className='mr-2 h-4 w-4' />{submitting ? 'Processing...' : 'Continue workflow'}</Button>
                      <Button variant='outline' className='border-red-300 text-red-700 hover:bg-red-50' onClick={() => decide('reject')} disabled={submitting !== null}><Icons.close className='mr-2 h-4 w-4' />Reject and stop</Button>
                    </div>
                  </div>
                )}

                {(selected.status === 'approved' || selected.status === 'modified') && ['waiting_for_human', 'held_by_human', 'blocked_by_policy'].includes(selected.agent_run_status) && (
                  <div className='rounded-xl border border-amber-200 bg-amber-50 p-4'>
                    <p className='font-semibold text-amber-900'>Approval saved; workflow continuation pending</p>
                    <p className='mt-1 text-sm text-amber-800'>{selected.agent_run_status === 'blocked_by_policy' ? 'The human override is recorded. Continue with a recovery run that bypasses this policy block for the approved case.' : 'The decision is already recorded. Continue the existing paused Supervity workflow without approving it again.'}</p>
                    <Button className='mt-3 bg-emerald-600 hover:bg-emerald-700' onClick={continueApprovedWorkflow} disabled={submitting !== null}>
                      <Icons.check className='mr-2 h-4 w-4' />
                      {submitting === 'resume' ? 'Continuing...' : 'Continue approved workflow'}
                    </Button>
                  </div>
                )}

                {(selected.status === 'rejected' || selected.status === 'resumed') && selected.decision_notes && (
                  <div className='rounded-xl border bg-slate-50 p-4'><p className='text-xs font-semibold uppercase tracking-wide text-brand-muted'>Decision record</p><p className='mt-2 text-sm text-slate-700'>{selected.decision_notes}</p></div>
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </motion.div>
  )
}
