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

type InsightsSummary = {
  analyzed_runs: number
  completed: number
  failed: number
  blocked: number
  waiting_for_human: number
  completion_rate: number
  average_duration_seconds: number | null
}

type InsightsResponse = {
  summary: InsightsSummary
  insights: Insight[]
  patterns: Pattern[]
  actions: ActionItem[]
  generated_at: string
}

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

  const loadInsights = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const response = await apiClient.get<InsightsResponse>('/api/insights/orchestrator?limit=200')
      setData(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze orchestrator data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadInsights() }, [loadInsights])

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

      {summary && (
        <motion.div variants={itemVariants} className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
          {[
            { label: 'Analyzed Runs', value: summary.analyzed_runs, detail: 'Persisted workflow sample', icon: Icons.activity, color: 'bg-blue-100 text-blue-700' },
            { label: 'Completion Rate', value: `${Math.round(summary.completion_rate * 100)}%`, detail: `${summary.completed} successful runs`, icon: Icons.checkCircle, color: 'bg-emerald-100 text-emerald-700' },
            { label: 'Failures', value: summary.failed, detail: 'Requires reliability review', icon: Icons.alertTriangle, color: 'bg-red-100 text-red-700' },
            { label: 'Awaiting Human', value: summary.waiting_for_human, detail: 'Pending Workbench decisions', icon: Icons.user, color: 'bg-purple-100 text-purple-700' },
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
                {data?.insights.length ? data.insights.map((insight) => <InsightCard key={insight.id} insight={insight} onAction={(item) => routeAction(item.action_type)} onDismiss={dismissInsight} />) : <EmptyState title='Not enough workflow evidence yet' detail='Run the orchestrator to build an execution history for analysis.' />}
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
    </motion.div>
  )
}
