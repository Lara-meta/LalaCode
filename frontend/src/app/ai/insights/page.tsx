'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'

import { apiClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CardWatermark } from '@/components/ui/card-watermark'
import { Icons } from '@/components/ui/icons'
import { InsightCard, type Insight } from '@/components/ai/insights/InsightCard'
import { PatternCluster, type Pattern } from '@/components/ai/insights/PatternCluster'
import { ActionCard, type ActionItem } from '@/components/ai/insights/ActionCard'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

type InsightsSummary = {
  analyzed_runs: number
  completed: number
  failed: number
  blocked: number
  waiting_for_human: number
  review_unavailable: number
  completion_rate: number
  average_duration_seconds: number | null
}

type InsightsResponse = {
  summary: InsightsSummary
  comparison: {
    previous: InsightsSummary
    deltas: { analyzed_runs: number; completion_rate: number; failed: number; waiting_for_human: number }
  }
  window: { period: string; start: string; end: string; previous_start: string; previous_end: string }
  insights: Insight[]
  patterns: Pattern[]
  actions: ActionItem[]
  generated_at: string
}

type EvidenceRecord = {
  run_id: number
  status: string
  item_number?: string | null
  supplier_id?: string | null
  notice_id?: string | null
  notice_type?: string | null
  triggered_at: string
  completed_at?: string | null
  error?: string | null
  operators: Array<{ name: string; status: string }>
  operator_count: number
}

type EvidenceResponse = { insight_id: string; total: number; records: EvidenceRecord[] }

const tabs = [
  { id: 'summary', label: 'Insights', icon: Icons.lightbulb },
  { id: 'patterns', label: 'Patterns', icon: Icons.layers },
  { id: 'actions', label: 'Actions', icon: Icons.zap },
] as const

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className='flex flex-col items-center justify-center py-14 text-center'>
      <div className='mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-cornflower/10'>
        <Icons.activity className='h-7 w-7 text-brand-cornflower' />
      </div>
      <h3 className='font-semibold text-brand-navy'>{title}</h3>
      <p className='mt-1 max-w-md text-sm text-muted-foreground'>{detail}</p>
    </div>
  )
}

export default function AIInsightsPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['id']>('summary')
  const [data, setData] = useState<InsightsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [period, setPeriod] = useState<'24h' | '7d' | '30d' | 'custom'>('7d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [evidenceInsight, setEvidenceInsight] = useState<Insight | null>(null)
  const [evidence, setEvidence] = useState<EvidenceResponse | null>(null)
  const [evidenceLoading, setEvidenceLoading] = useState(false)
  const [evidenceError, setEvidenceError] = useState('')

  const buildParams = useCallback(() => {
    const params = new URLSearchParams({ limit: '500', period })
    if (period === 'custom' && customStart && customEnd) {
      params.set('start', new Date(customStart).toISOString())
      params.set('end', new Date(customEnd).toISOString())
    }
    return params
  }, [period, customStart, customEnd])

  const loadInsights = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const params = buildParams()
      if (period === 'custom') {
        if (!customStart || !customEnd) return
        params.set('start', new Date(customStart).toISOString())
        params.set('end', new Date(customEnd).toISOString())
      }
      const response = await apiClient.get<InsightsResponse>(`/api/insights/orchestrator?${params}`)
      setData(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze orchestrator data.')
    } finally {
      setLoading(false)
    }
  }, [period, customStart, customEnd, buildParams])

  const openEvidence = useCallback(async (insight: Insight) => {
    setEvidenceInsight(insight)
    setEvidence(null)
    setEvidenceError('')
    setEvidenceLoading(true)
    try {
      const params = buildParams()
      params.set('limit', '100')
      setEvidence(await apiClient.get<EvidenceResponse>(`/api/insights/orchestrator/evidence/${insight.id}?${params}`))
    } catch (err) {
      setEvidenceError(err instanceof Error ? err.message : 'Could not load supporting records.')
    } finally {
      setEvidenceLoading(false)
    }
  }, [buildParams])

  useEffect(() => {
    if (period !== 'custom') loadInsights()
  }, [loadInsights, period])

  const routeAction = useCallback((actionType?: string) => {
    if (actionType === 'review_workbench') router.push('/workbench')
    else if (actionType === 'review_policies') router.push('/ai/policies')
    else router.push('/')
  }, [router])

  const dismissInsight = useCallback((id: string) => {
    setData((current) => current ? {
      ...current,
      insights: current.insights.filter((insight) => insight.id !== id),
    } : current)
  }, [])

  const summary = data?.summary

  return (
    <motion.div className='space-y-6' variants={containerVariants} initial='hidden' animate='visible'>
      <motion.div variants={itemVariants} className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <div className='mb-2 flex items-center gap-2 text-sm font-semibold text-brand-cornflower'>
            <Icons.brain className='h-4 w-4' /> Orchestrator intelligence
          </div>
          <h1 className='text-display-3 font-bold tracking-tight text-brand-navy lg:text-display-2'>AI Insights</h1>
          <p className='mt-2 text-lg text-muted-foreground'>Patterns, risks, and recommended actions generated from your real workflow history.</p>
        </div>
        <Button variant='gradient' onClick={loadInsights} disabled={loading}>
          <Icons.sparkles className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
          {loading ? 'Analyzing...' : 'Run analysis'}
        </Button>
      </motion.div>

      {error && (
        <motion.div variants={itemVariants} className='rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700'>
          {error}
        </motion.div>
      )}

      <motion.div variants={itemVariants} className='flex flex-col gap-3 rounded-xl border border-border/60 bg-white/70 p-3 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex flex-wrap gap-2'>
          {(['24h', '7d', '30d', 'custom'] as const).map((value) => (
            <Button key={value} size='sm' variant={period === value ? 'default' : 'outline'} onClick={() => setPeriod(value)}>
              {value === '24h' ? 'Last 24 hours' : value === '7d' ? 'Last 7 days' : value === '30d' ? 'Last 30 days' : 'Custom range'}
            </Button>
          ))}
        </div>
        {period === 'custom' && (
          <div className='flex flex-wrap items-center gap-2'>
            <input aria-label='Custom range start' type='datetime-local' value={customStart} onChange={(event) => setCustomStart(event.target.value)} className='h-9 rounded-md border border-input bg-background px-3 text-sm' />
            <span className='text-sm text-muted-foreground'>to</span>
            <input aria-label='Custom range end' type='datetime-local' value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} className='h-9 rounded-md border border-input bg-background px-3 text-sm' />
            <Button size='sm' onClick={loadInsights} disabled={loading || !customStart || !customEnd}>Apply</Button>
          </div>
        )}
        {data?.window && <p className='text-xs text-muted-foreground'>{new Date(data.window.start).toLocaleString()} – {new Date(data.window.end).toLocaleString()}</p>}
      </motion.div>

      {summary && (
        <motion.div variants={itemVariants} className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
          {[
            { label: 'Analyzed Runs', value: summary.analyzed_runs, detail: `${data.comparison.deltas.analyzed_runs >= 0 ? '+' : ''}${data.comparison.deltas.analyzed_runs} vs previous period`, icon: Icons.activity, color: 'bg-blue-100 text-blue-700' },
            { label: 'Completion Rate', value: `${Math.round(summary.completion_rate * 100)}%`, detail: `${data.comparison.deltas.completion_rate >= 0 ? '+' : ''}${Math.round(data.comparison.deltas.completion_rate * 100)} points vs previous`, icon: Icons.checkCircle, color: 'bg-emerald-100 text-emerald-700' },
            { label: 'Failures', value: summary.failed, detail: `${data.comparison.deltas.failed >= 0 ? '+' : ''}${data.comparison.deltas.failed} vs previous period`, icon: Icons.alertTriangle, color: 'bg-red-100 text-red-700' },
            { label: 'Awaiting Human', value: summary.waiting_for_human, detail: `${data.comparison.deltas.waiting_for_human >= 0 ? '+' : ''}${data.comparison.deltas.waiting_for_human} vs previous period`, icon: Icons.user, color: 'bg-purple-100 text-purple-700' },
          ].map((stat) => {
            const Icon = stat.icon
            return (
              <Card key={stat.label} className='relative overflow-hidden'>
                <CardWatermark opacity={2} scale={0.8} />
                <CardContent className='relative z-10 flex items-center gap-4 py-6'>
                  <div className={cn('flex h-12 w-12 items-center justify-center rounded-xl', stat.color)}><Icon className='h-6 w-6' /></div>
                  <div><p className='text-2xl font-bold text-brand-navy'>{stat.value}</p><p className='text-sm font-medium'>{stat.label}</p><p className='text-xs text-muted-foreground'>{stat.detail}</p></div>
                </CardContent>
              </Card>
            )
          })}
        </motion.div>
      )}

      <motion.div variants={itemVariants} className='flex flex-wrap gap-1 rounded-xl border border-border/50 bg-white/50 p-1 sm:inline-flex'>
        {tabs.map((tab) => {
          const Icon = tab.icon
          const selected = tab.id === activeTab
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={cn('relative flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors', selected ? 'text-white' : 'text-muted-foreground hover:bg-white hover:text-foreground')}>
              {selected && <motion.div layoutId='activeInsightTab' className='absolute inset-0 rounded-lg bg-brand-navy' />}
              <span className='relative z-10 flex items-center gap-2'><Icon className='h-4 w-4' />{tab.label}</span>
            </button>
          )
        })}
      </motion.div>

      <AnimatePresence mode='wait'>
        <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
          {loading && !data ? (
            <Card><CardContent className='flex items-center justify-center py-20'><Icons.loader className='h-8 w-8 animate-spin text-brand-cornflower' /></CardContent></Card>
          ) : activeTab === 'summary' ? (
            <Card className='relative overflow-hidden'>
              <CardWatermark opacity={2} scale={1} />
              <CardHeader className='relative z-10'><CardTitle>Workflow Insights</CardTitle><CardDescription>{data?.insights.length ?? 0} findings generated from orchestrator outcomes and execution history.</CardDescription></CardHeader>
              <CardContent className='relative z-10 space-y-4'>
                {data?.insights.length ? data.insights.map((insight) => <InsightCard key={insight.id} insight={insight} onAction={(item) => routeAction(item.action_type)} onDismiss={dismissInsight} onEvidence={openEvidence} />) : <EmptyState title='Not enough workflow evidence yet' detail='Run the orchestrator to build an execution history for analysis.' />}
              </CardContent>
            </Card>
          ) : activeTab === 'patterns' ? (
            <Card className='relative overflow-hidden'>
              <CardWatermark opacity={2} scale={1} />
              <CardHeader className='relative z-10'><CardTitle>Detected Patterns</CardTitle><CardDescription>Recurring disruption and operator-performance signals.</CardDescription></CardHeader>
              <CardContent className='relative z-10'><PatternCluster patterns={data?.patterns ?? []} /></CardContent>
            </Card>
          ) : (
            <Card className='relative overflow-hidden'>
              <CardWatermark opacity={2} scale={1} />
              <CardHeader className='relative z-10'><CardTitle>Recommended Actions</CardTitle><CardDescription>Prioritized next steps based on current workflow evidence.</CardDescription></CardHeader>
              <CardContent className='relative z-10 space-y-3'>
                {data?.actions.length ? data.actions.map((action, index) => <ActionCard key={`${action.action_type}-${index}`} action={action} onApply={(item) => routeAction(item.action_type)} />) : <EmptyState title='No action required' detail='The analyzed workflow history has no current recommendations.' />}
              </CardContent>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>

      {data && <p className='text-right text-xs text-muted-foreground'>Analyzed {new Date(data.generated_at).toLocaleString()}</p>}

      <Sheet open={Boolean(evidenceInsight)} onOpenChange={(open) => { if (!open) setEvidenceInsight(null) }}>
        <SheetContent side='right' className='w-full overflow-y-auto sm:max-w-3xl'>
          <SheetHeader className='pr-8'>
            <SheetTitle>{evidenceInsight?.title}</SheetTitle>
            <SheetDescription>Database records supporting this insight for the selected analysis window.</SheetDescription>
          </SheetHeader>
          {evidenceLoading ? (
            <div className='flex justify-center py-20'><Icons.loader className='h-7 w-7 animate-spin text-brand-cornflower' /></div>
          ) : evidenceError ? (
            <div className='mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700'>{evidenceError}</div>
          ) : evidence ? (
            <div className='mt-6 space-y-3'>
              <p className='text-sm font-medium text-brand-navy'>{evidence.total} supporting record{evidence.total === 1 ? '' : 's'}</p>
              {evidence.records.map((record) => (
                <div key={record.run_id} className='rounded-xl border bg-white p-4 shadow-sm'>
                  <div className='flex flex-wrap items-start justify-between gap-2'>
                    <div>
                      <p className='font-semibold text-brand-navy'>Run #{record.run_id} · {record.item_number || 'Unknown item'}</p>
                      <p className='mt-1 text-xs text-muted-foreground'>Supplier {record.supplier_id || '—'} · Notice {record.notice_id || '—'} · {record.notice_type?.replaceAll('_', ' ') || 'Unknown type'}</p>
                    </div>
                    <span className='rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700'>{record.status.replaceAll('_', ' ')}</span>
                  </div>
                  {record.error && <div className='mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700'>{record.error}</div>}
                  {record.operators.length > 0 && <div className='mt-3 flex flex-wrap gap-2'>{record.operators.map((operator, index) => <span key={`${operator.name}-${index}`} className='rounded-full border bg-slate-50 px-2.5 py-1 text-xs'>{operator.name}: <strong>{operator.status}</strong></span>)}</div>}
                  <div className='mt-3 flex flex-wrap items-center justify-between gap-2'>
                    <span className='text-xs text-muted-foreground'>{new Date(record.triggered_at).toLocaleString()}</span>
                    <Button size='sm' variant='outline' onClick={() => router.push(`/?run=${record.run_id}`)}>Open run <Icons.arrowRight className='ml-1.5 h-3.5 w-3.5' /></Button>
                  </div>
                </div>
              ))}
              {evidence.records.length === 0 && <EmptyState title='No supporting records' detail='No records matched this insight in the selected period.' />}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </motion.div>
  )
}
