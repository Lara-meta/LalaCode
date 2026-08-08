'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { ElementType } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { CardWatermark } from '@/components/ui/card-watermark'
import { Icons } from '@/components/ui/icons'


// ============================================================
// TYPES
// ============================================================

type Summary = {
  total_runs: number
  completed: number
  blocked: number
  failed: number
  active: number
  stalled: number
  stalled_after_minutes: number
  waiting_for_human: number
  review_unavailable: number
  rejected: number
  superseded: number
  other: number
}

type ActivityData = {
  date: string
  label: string
  total: number
  completed: number
  blocked: number
  failed: number
  active: number
  human_assisted: number
  unresolved: number
}

type RecentRun = {
  id: number
  disruption_id: number
  notice_id: string | null
  item_number: string | null
  notice_type: string | null
  supervity_run_id: string | null
  status: string
  triggered_at: string
  completed_at: string | null
  supplier_id: string | null
  severity: string | null
  exposure_value: number | null
  recommended_strategy: string | null
  priority: 'critical' | 'high' | 'medium' | 'low'
  age_minutes: number | null
  workbench_item_id: number | null
}

type OperatorActivity = {
  id: number
  agent_run_id: number
  operator_name: string
  status: string
  created_at: string
}

type HealthItem = {
  status: string
  detail: string
}

type DashboardResponse = {
  summary: Summary
  action_required: {
    pending_reviews: number
    failed_runs: number
    policy_blocks: number
    stalled_runs: number
    oldest_wait_minutes: number | null
    oldest_review_id: number | null
  }
  activity_chart: ActivityData[]
  recent_runs: RecentRun[]
  recent_operators: OperatorActivity[]

  system_health: {
    backend: HealthItem
    database: HealthItem

    supervity: HealthItem & {
      configured: boolean
      last_success_run: number | null
    }
  }

  last_updated: string
}


// ============================================================
// HELPERS
// ============================================================

function formatStatus(status: string) {
  return status
    .replaceAll('_', ' ')
    .toUpperCase()
}

function statusClasses(status: string) {
  if (status === 'completed') {
    return 'bg-emerald-100 text-emerald-700'
  }

  if (status === 'blocked_by_policy') {
    return 'bg-amber-100 text-amber-700'
  }

  if (status === 'failed') {
    return 'bg-red-100 text-red-700'
  }

  if (status === 'stalled') {
    return 'bg-orange-100 text-orange-800'
  }

  if (status === 'review_unavailable') {
    return 'bg-red-100 text-red-800'
  }

  if (status === 'running') {
    return 'bg-blue-100 text-blue-700'
  }

  if (status === 'evaluating_policies') {
    return 'bg-purple-100 text-purple-700'
  }

  return 'bg-gray-100 text-gray-700'
}

function healthClasses(status: string) {
  if (status === 'healthy') {
    return 'bg-emerald-100 text-emerald-700'
  }

  if (status === 'configured') {
    return 'bg-amber-100 text-amber-700'
  }

  return 'bg-red-100 text-red-700'
}


// ============================================================
// SUMMARY CARD
// ============================================================

function SummaryCard({
  title,
  value,
  icon: Icon,
  description,
}: {
  title: string
  value: number
  icon: ElementType
  description: string
}) {
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <Card className='group relative h-full overflow-hidden'>
        <CardWatermark
          opacity={3}
          scale={0.9}
        />

        <CardContent className='relative z-10 p-5'>
          <div className='flex items-start justify-between'>
            <div>
              <p className='text-xs font-semibold uppercase tracking-wider text-brand-muted'>
                {title}
              </p>

              <p className='mt-3 text-4xl font-bold tracking-tight text-brand-navy'>
                {value}
              </p>

              <p className='mt-2 text-xs text-muted-foreground'>
                {description}
              </p>
            </div>

            <div className='rounded-xl bg-brand-navy p-2.5 text-white shadow-lg'>
              <Icon
                className='h-5 w-5'
                strokeWidth={1.5}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}


// ============================================================
// ORCHESTRATION ACTIVITY CHART
// ============================================================

function RecoveryOutcomesChart({
  data,
}: {
  data: ActivityData[]
}) {
  const totals = data.reduce((summary, item) => ({
    received: summary.received + item.total,
    completed: summary.completed + item.completed,
    assisted: summary.assisted + item.human_assisted,
    unresolved: summary.unresolved + item.unresolved,
  }), { received: 0, completed: 0, assisted: 0, unresolved: 0 })

  return (
    <Card className='relative overflow-hidden'>
      <CardWatermark
        opacity={3}
        scale={1.1}
      />

      <CardHeader className='relative z-10'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <CardTitle className='flex items-center gap-2'>
              <Icons.barChart
                className='h-5 w-5 text-brand-cornflower'
                strokeWidth={1.5}
              />

              Recovery Outcomes
            </CardTitle>

            <p className='mt-1 text-sm text-muted-foreground'>
              Recovery volume and outcomes over the last 7 days.
            </p>
          </div>

          <div className='grid grid-cols-2 gap-x-5 gap-y-2 text-left sm:grid-cols-4 sm:text-right'>
            {[
              ['Received', totals.received],
              ['Auto-resolved', totals.completed],
              ['Human-assisted', totals.assisted],
              ['Unresolved', totals.unresolved],
            ].map(([label, value]) => <div key={label}><p className='text-[10px] uppercase tracking-wide text-brand-muted'>{label}</p><p className='text-lg font-bold text-brand-navy'>{value}</p></div>)}
          </div>
        </div>
      </CardHeader>

      <CardContent className='relative z-10'>
        <div className='h-[300px] w-full'>
          <ResponsiveContainer
            width='100%'
            height='100%'
          >
            <BarChart
              data={data}
              margin={{
                top: 10,
                right: 20,
                left: -15,
                bottom: 0,
              }}
            >
              <CartesianGrid
                strokeDasharray='3 3'
                vertical={false}
                stroke='rgba(20, 26, 66, 0.08)'
              />

              <XAxis
                dataKey='label'
                axisLine={false}
                tickLine={false}
                tick={{
                  fill: '#7B8AB8',
                  fontSize: 12,
                }}
              />

              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{
                  fill: '#7B8AB8',
                  fontSize: 12,
                }}
              />

              <Tooltip
                cursor={{
                  fill: 'rgba(91, 141, 239, 0.05)',
                }}
              />

              <Legend />

              <Bar
                dataKey='total'
                name='Received'
                fill='#CBD5E1'
                radius={[6, 6, 0, 0]}
              />

              <Bar
                dataKey='completed'
                name='Auto-resolved'
                fill='#5B8DEF'
                radius={[6, 6, 0, 0]}
              />

              <Bar
                dataKey='human_assisted'
                name='Human-assisted'
                fill='#7C5CE7'
                radius={[6, 6, 0, 0]}
              />

              <Bar
                dataKey='unresolved'
                name='Unresolved'
                fill='#EF4444'
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}


// ============================================================
// MAIN PAGE
// ============================================================

export default function HomePage() {
  const [dashboard, setDashboard] =
    useState<DashboardResponse | null>(null)

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState('')
  const [runSearch, setRunSearch] = useState('')
  const [runStatus, setRunStatus] = useState('attention')
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null)


  // ============================================================
  // LOAD DASHBOARD
  // ============================================================

  const loadDashboard =
    useCallback(async () => {
      try {
        setLoading(true)
        setError('')

        const data =
          await apiClient.get<DashboardResponse>(
            '/api/dashboard/operations?limit=50'
          )

        setDashboard(data)

      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load operational dashboard'
        )

      } finally {
        setLoading(false)
      }
    }, [])


  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  const filteredRuns = useMemo(() => {
    if (!dashboard) return []
    const attention = ['waiting_for_human', 'review_unavailable', 'stalled', 'failed', 'blocked_by_policy']
    return dashboard.recent_runs.filter((run) => {
      const matchesStatus = runStatus === 'all' || (runStatus === 'attention' ? attention.includes(run.status) : run.status === runStatus)
      const haystack = `${run.item_number} ${run.notice_id} ${run.notice_type} ${run.supplier_id}`.toLowerCase()
      return matchesStatus && haystack.includes(runSearch.trim().toLowerCase())
    })
  }, [dashboard, runSearch, runStatus])


  // ============================================================
  // LOADING
  // ============================================================

  if (loading) {
    return (
      <div className='space-y-4'>
        <h1 className='text-4xl font-bold text-brand-navy'>
          Operational Dashboard
        </h1>

        <p className='text-muted-foreground'>
          Loading live orchestration data...
        </p>
      </div>
    )
  }


  // ============================================================
  // ERROR
  // ============================================================

  if (error || !dashboard) {
    return (
      <div className='space-y-4'>
        <h1 className='text-4xl font-bold text-brand-navy'>
          Operational Dashboard
        </h1>

        <div className='rounded-xl border border-red-200 bg-red-50 p-4 text-red-700'>
          {error || 'Dashboard data unavailable'}
        </div>

        <Button
          onClick={loadDashboard}
        >
          Try Again
        </Button>
      </div>
    )
  }


  // ============================================================
  // PAGE
  // ============================================================

  return (
    <motion.div
      className='space-y-6'
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >

      {/* ====================================================== */}
      {/* HEADER */}
      {/* ====================================================== */}

      <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <h1 className='text-4xl font-bold tracking-tight text-brand-navy lg:text-5xl'>
            Operational Dashboard
          </h1>

          <p className='mt-2 text-lg text-muted-foreground'>
            Live view of disruption orchestration,
            operator execution, and system health.
          </p>
        </div>

        <div className='flex items-center gap-3'>
          <span className='text-xs text-muted-foreground'>
            Updated{' '}
            {new Date(
              dashboard.last_updated
            ).toLocaleTimeString()}
          </span>

          <Button
            variant='outline'
            onClick={loadDashboard}
          >
            <Icons.refresh className='mr-2 h-4 w-4' />
            Refresh
          </Button>
        </div>
      </div>

      <ActionRequired data={dashboard.action_required} />

      {/* ====================================================== */}
      {/* SUMMARY CARDS */}
      {/* ====================================================== */}

      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div><h2 className='text-xl font-semibold text-brand-navy'>Current workflow status</h2><p className='mt-1 text-sm text-muted-foreground'>Every orchestration attempt is classified by its latest state.</p></div>
        <div className='rounded-full border bg-white px-4 py-2 text-sm text-brand-muted'><span className='font-bold text-brand-navy'>{dashboard.summary.total_runs}</span> total attempts</div>
      </div>

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <SummaryCard
          title='Running'
          value={dashboard.summary.active}
          icon={Icons.loader}
          description='Actively executing now'
        />

        <SummaryCard
          title='Awaiting Decision'
          value={dashboard.summary.waiting_for_human}
          icon={Icons.clock}
          description='Paused for human selection'
        />

        <SummaryCard
          title='Stalled'
          value={dashboard.summary.stalled}
          icon={Icons.alertTriangle}
          description={`No progress for ${dashboard.summary.stalled_after_minutes}+ minutes`}
        />

        {dashboard.summary.review_unavailable > 0 && <SummaryCard
          title='Review Unavailable'
          value={dashboard.summary.review_unavailable}
          icon={Icons.alertTriangle}
          description='Legacy waiting runs without an open review'
        />}

        <SummaryCard
          title='Completed'
          value={dashboard.summary.completed}
          icon={Icons.checkCircle}
          description='Successfully completed workflows'
        />

        <SummaryCard
          title='Rejected'
          value={dashboard.summary.rejected}
          icon={Icons.close}
          description='Stopped by human decision'
        />

        <SummaryCard
          title='Blocked'
          value={dashboard.summary.blocked}
          icon={Icons.shield}
          description='Stopped by policy controls'
        />

        <SummaryCard
          title='Failed'
          value={dashboard.summary.failed}
          icon={Icons.alertTriangle}
          description='Runs that ended with errors'
        />

        <SummaryCard
          title='Previous Runs'
          value={dashboard.summary.superseded}
          icon={Icons.activity}
          description='Replaced after human decision'
        />

        {dashboard.summary.other > 0 && <SummaryCard
          title='Other'
          value={dashboard.summary.other}
          icon={Icons.activity}
          description='Unclassified legacy states'
        />}

      </div>


      {/* ====================================================== */}
      {/* BAR CHART */}
      {/* ====================================================== */}

      <RecoveryOutcomesChart
        data={dashboard.activity_chart}
      />


      {/* ====================================================== */}
      {/* RECENT RUNS */}
      {/* ====================================================== */}

      <Card id='recent-runs' className='scroll-mt-24'>
        <CardHeader>
          <CardTitle>Priority Disruption Queue</CardTitle>

          <p className='text-sm text-muted-foreground'>
            Search, prioritize, and act on recovery workflows that need attention.
          </p>
        </CardHeader>

        <CardContent>
          <div className='mb-4 flex flex-col gap-3 sm:flex-row'>
            <input value={runSearch} onChange={(event) => setRunSearch(event.target.value)} placeholder='Search item, notice, supplier, or disruption...' className='h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-brand-cornflower' />
            <select value={runStatus} onChange={(event) => setRunStatus(event.target.value)} className='h-10 rounded-md border border-input bg-background px-3 text-sm'>
              <option value='attention'>Needs attention</option><option value='all'>All statuses</option><option value='waiting_for_human'>Awaiting decision</option><option value='review_unavailable'>Review unavailable</option><option value='stalled'>Stalled</option><option value='failed'>Failed</option><option value='blocked_by_policy'>Policy blocked</option><option value='completed'>Completed</option>
            </select>
          </div>
          {filteredRuns.length === 0 ? (
            <p className='py-8 text-center text-sm text-muted-foreground'>
              No workflows match these filters.
            </p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full text-left text-sm'>

                <thead>
                  <tr className='border-b'>
                    <th className='px-4 py-3 font-semibold'>
                      Priority
                    </th>

                    <th className='px-4 py-3 font-semibold'>
                      Item
                    </th>

                    <th className='px-4 py-3 font-semibold'>
                      Disruption
                    </th>

                    <th className='px-4 py-3 font-semibold'>
                      Status
                    </th>

                    <th className='px-4 py-3 font-semibold'>
                      Age
                    </th>

                    <th className='px-4 py-3 font-semibold'>
                      Action
                    </th>
                  </tr>
                </thead>


                <tbody>
                  {filteredRuns.map(
                    (run) => (
                      <Fragment key={run.id}><tr className='border-b last:border-0'>

                        <td className='px-4 py-4'>
                          <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${priorityClasses(run.priority)}`}>{run.priority}</span>
                        </td>

                        <td className='px-4 py-4 font-medium'>
                          <p>{run.item_number || '—'}</p><p className='mt-1 text-xs text-muted-foreground'>Notice {run.notice_id || '—'} · Supplier {run.supplier_id || '—'}</p>
                        </td>

                        <td className='px-4 py-4'>
                          {titleCase(run.notice_type)}
                        </td>

                        <td className='px-4 py-4'>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses(
                              run.status
                            )}`}
                          >
                            {formatStatus(run.status)}
                          </span>
                        </td>

                        <td className='px-4 py-4'>
                          <span className='font-medium'>{formatAge(run.age_minutes)}</span>
                        </td>

                        <td className='px-4 py-4'>
                          {run.status === 'waiting_for_human' && run.workbench_item_id ? <Button asChild size='sm'><Link href={`/workbench?review=${run.workbench_item_id}`}>Review</Link></Button> : run.status === 'blocked_by_policy' ? <Button asChild size='sm' variant='outline'><Link href='/ai/policies'>Policies</Link></Button> : <Button size='sm' variant='outline' onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}>Details</Button>}
                        </td>
                      </tr>
                      {expandedRunId === run.id && <tr className='border-b bg-slate-50/70'><td colSpan={7} className='px-4 py-4'><div className='grid gap-3 text-sm sm:grid-cols-3'><div><p className='text-xs font-semibold uppercase text-brand-muted'>Run</p><p className='mt-1'>#{run.id}</p></div><div><p className='text-xs font-semibold uppercase text-brand-muted'>Triggered</p><p className='mt-1'>{new Date(run.triggered_at).toLocaleString()}</p></div>{run.recommended_strategy && <div><p className='text-xs font-semibold uppercase text-brand-muted'>Recommended strategy</p><p className='mt-1'>{run.recommended_strategy}</p></div>}{run.status === 'review_unavailable' && <div className='sm:col-span-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900'>This legacy run is marked as waiting, but it has no open Workbench review. No Review button is shown because there is nothing actionable.</div>}{run.supervity_run_id && <div className='sm:col-span-3'><p className='text-xs font-semibold uppercase text-brand-muted'>Supervity run</p><p className='mt-1 break-all font-mono text-xs'>{run.supervity_run_id}</p></div>}</div></td></tr>}
                      </Fragment>
                    )
                  )}
                </tbody>

              </table>
            </div>
          )}
        </CardContent>
      </Card>


      {/* ====================================================== */}
      {/* OPERATOR ACTIVITY + SYSTEM HEALTH */}
      {/* ====================================================== */}

      <div className='grid gap-6 lg:grid-cols-3'>


        {/* ==================================================== */}
        {/* OPERATOR ACTIVITY */}
        {/* ==================================================== */}

        <Card className='lg:col-span-2'>
          <CardHeader>
            <CardTitle>
              Recent Operator Activity
            </CardTitle>

            <p className='text-sm text-muted-foreground'>
              Operators executed during recent recovery workflows.
            </p>
          </CardHeader>

          <CardContent>
            {dashboard.recent_operators.length === 0 ? (
              <p className='py-8 text-center text-sm text-muted-foreground'>
                No operator activity found.
              </p>
            ) : (
              <div className='overflow-x-auto'>
                <table className='w-full text-left text-sm'>

                  <thead>
                    <tr className='border-b'>

                      <th className='px-4 py-3 font-semibold'>
                        Run
                      </th>

                      <th className='px-4 py-3 font-semibold'>
                        Operator
                      </th>

                      <th className='px-4 py-3 font-semibold'>
                        Status
                      </th>

                      <th className='px-4 py-3 font-semibold'>
                        Recorded
                      </th>

                    </tr>
                  </thead>


                  <tbody>
                    {dashboard.recent_operators.map(
                      (operator) => (
                        <tr
                          key={operator.id}
                          className='border-b last:border-0'
                        >

                          <td className='px-4 py-4 font-mono'>
                            {operator.agent_run_id}
                          </td>

                          <td className='px-4 py-4 font-medium'>
                            {operator.operator_name}
                          </td>

                          <td className='px-4 py-4'>
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses(
                                operator.status
                              )}`}
                            >
                              {formatStatus(
                                operator.status
                              )}
                            </span>
                          </td>

                          <td className='px-4 py-4 text-muted-foreground'>
                            {new Date(
                              operator.created_at
                            ).toLocaleString()}
                          </td>

                        </tr>
                      )
                    )}
                  </tbody>

                </table>
              </div>
            )}
          </CardContent>
        </Card>


        {/* ==================================================== */}
        {/* SYSTEM HEALTH */}
        {/* ==================================================== */}

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Icons.activity
                className='h-5 w-5 text-brand-cornflower'
              />

              System Health
            </CardTitle>

            <p className='text-sm text-muted-foreground'>
              Current platform readiness.
            </p>
          </CardHeader>


          <CardContent className='space-y-5'>

            {/* BACKEND */}

            <div className='flex items-center justify-between gap-4 border-b pb-4'>
              <div>
                <p className='font-medium'>
                  Backend
                </p>

                <p className='mt-1 text-xs text-muted-foreground'>
                  {dashboard.system_health.backend.detail}
                </p>
              </div>

              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${healthClasses(
                  dashboard.system_health.backend.status
                )}`}
              >
                {dashboard.system_health.backend.status.toUpperCase()}
              </span>
            </div>


            {/* DATABASE */}

            <div className='flex items-center justify-between gap-4 border-b pb-4'>
              <div>
                <p className='font-medium'>
                  Database
                </p>

                <p className='mt-1 text-xs text-muted-foreground'>
                  {dashboard.system_health.database.detail}
                </p>
              </div>

              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${healthClasses(
                  dashboard.system_health.database.status
                )}`}
              >
                {dashboard.system_health.database.status.toUpperCase()}
              </span>
            </div>


            {/* SUPERVITY */}

            <div className='flex items-center justify-between gap-4'>
              <div>
                <p className='font-medium'>
                  Supervity
                </p>

                <p className='mt-1 text-xs text-muted-foreground'>
                  {dashboard.system_health.supervity.detail}
                </p>
              </div>

              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${healthClasses(
                  dashboard.system_health.supervity.status
                )}`}
              >
                {dashboard.system_health.supervity.status
                  .replaceAll('_', ' ')
                  .toUpperCase()}
              </span>
            </div>

          </CardContent>
        </Card>

      </div>

    </motion.div>
  )
}

function titleCase(value: string | null) {
  return value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Not provided'
}

function formatAge(minutes: number | null) {
  if (minutes === null) return '—'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${Math.floor(minutes / 1440)}d`
}

function priorityClasses(priority: RecentRun['priority']) {
  if (priority === 'critical') return 'bg-red-600 text-white'
  if (priority === 'high') return 'bg-orange-100 text-orange-800'
  if (priority === 'medium') return 'bg-amber-100 text-amber-800'
  return 'bg-slate-100 text-slate-600'
}

function ActionRequired({ data }: { data: DashboardResponse['action_required'] }) {
  const total = data.pending_reviews + data.failed_runs + data.policy_blocks + data.stalled_runs
  const actions = [
    {
      label: 'Awaiting human decision',
      value: data.pending_reviews,
      detail: data.oldest_wait_minutes === null ? 'No pending reviews' : `Oldest waiting ${data.oldest_wait_minutes} min`,
      href: '/workbench',
      action: 'Review now',
      icon: Icons.clock,
      tone: 'border-purple-200 bg-purple-50 text-purple-900',
    },
    {
      label: 'Stalled workflows',
      value: data.stalled_runs,
      detail: 'Running without recent progress',
      href: '#recent-runs',
      action: 'Inspect stalled runs',
      icon: Icons.alertTriangle,
      tone: 'border-orange-200 bg-orange-50 text-orange-900',
    },
    {
      label: 'Failed workflows',
      value: data.failed_runs,
      detail: 'Runs requiring investigation',
      href: '#recent-runs',
      action: 'Investigate',
      icon: Icons.alertTriangle,
      tone: 'border-red-200 bg-red-50 text-red-900',
    },
    {
      label: 'Blocked by policy',
      value: data.policy_blocks,
      detail: 'Review policy configuration',
      href: '/ai/policies',
      action: 'View policies',
      icon: Icons.shield,
      tone: 'border-amber-200 bg-amber-50 text-amber-900',
    },
  ]

  return (
    <Card className='overflow-hidden border-slate-200'>
      <CardHeader className='border-b bg-slate-50/70 pb-4'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div><CardTitle className='flex items-center gap-2'><Icons.alertTriangle className='h-5 w-5 text-amber-600' />Action required</CardTitle><p className='mt-1 text-sm text-muted-foreground'>Exceptions that need an operator or administrator response.</p></div>
          <span className='rounded-full bg-brand-navy px-3 py-1 text-xs font-bold text-white'>{total} open</span>
        </div>
      </CardHeader>
      <CardContent className='grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4'>
        {actions.map(({ label, value, detail, href, action, icon: Icon, tone }) => (
          <Link key={label} href={href} className={`group rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${tone}`}>
            <div className='flex items-start justify-between gap-3'><div><p className='text-sm font-semibold'>{label}</p><p className='mt-2 text-3xl font-bold'>{value}</p></div><Icon className='h-5 w-5 opacity-70' /></div>
            <p className='mt-2 text-xs opacity-75'>{detail}</p>
            <p className='mt-4 text-sm font-semibold group-hover:underline'>{action} →</p>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
