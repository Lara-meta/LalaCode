'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ElementType } from 'react'
import { motion } from 'framer-motion'

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
}

type ActivityData = {
  date: string
  label: string
  total: number
  completed: number
  blocked: number
  failed: number
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

function OrchestrationActivityChart({
  data,
}: {
  data: ActivityData[]
}) {
  const totalLastSevenDays =
    data.reduce(
      (sum, item) => sum + item.total,
      0
    )

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

              Orchestration Activity
            </CardTitle>

            <p className='mt-1 text-sm text-muted-foreground'>
              Workflow outcomes over the last 7 days.
            </p>
          </div>

          <div className='text-left sm:text-right'>
            <p className='text-xs uppercase tracking-wide text-brand-muted'>
              7-Day Runs
            </p>

            <p className='text-xl font-bold text-brand-navy'>
              {totalLastSevenDays}
            </p>
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
                dataKey='completed'
                name='Completed'
                fill='#5B8DEF'
                radius={[6, 6, 0, 0]}
              />

              <Bar
                dataKey='blocked'
                name='Blocked'
                fill='#7C5CE7'
                radius={[6, 6, 0, 0]}
              />

              <Bar
                dataKey='failed'
                name='Failed'
                fill='#141A42'
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
            '/api/dashboard/operations?limit=10'
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


      {/* ====================================================== */}
      {/* SUMMARY CARDS */}
      {/* ====================================================== */}

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>

        <SummaryCard
          title='Total Runs'
          value={dashboard.summary.total_runs}
          icon={Icons.activity}
          description='All orchestration attempts'
        />

        <SummaryCard
          title='Completed'
          value={dashboard.summary.completed}
          icon={Icons.checkCircle}
          description='Successfully completed workflows'
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

      </div>


      {/* ====================================================== */}
      {/* BAR CHART */}
      {/* ====================================================== */}

      <OrchestrationActivityChart
        data={dashboard.activity_chart}
      />


      {/* ====================================================== */}
      {/* RECENT RUNS */}
      {/* ====================================================== */}

      <Card>
        <CardHeader>
          <CardTitle>
            Recent Orchestration Runs
          </CardTitle>

          <p className='text-sm text-muted-foreground'>
            Latest disruption recovery orchestration attempts.
          </p>
        </CardHeader>

        <CardContent>
          {dashboard.recent_runs.length === 0 ? (
            <p className='py-8 text-center text-sm text-muted-foreground'>
              No orchestration runs found.
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
                      Item
                    </th>

                    <th className='px-4 py-3 font-semibold'>
                      Notice
                    </th>

                    <th className='px-4 py-3 font-semibold'>
                      Notice Type
                    </th>

                    <th className='px-4 py-3 font-semibold'>
                      Status
                    </th>

                    <th className='px-4 py-3 font-semibold'>
                      Supervity Run
                    </th>

                    <th className='px-4 py-3 font-semibold'>
                      Triggered
                    </th>
                  </tr>
                </thead>


                <tbody>
                  {dashboard.recent_runs.map(
                    (run) => (
                      <tr
                        key={run.id}
                        className='border-b last:border-0'
                      >

                        <td className='px-4 py-4 font-mono font-semibold'>
                          {run.id}
                        </td>

                        <td className='px-4 py-4 font-medium'>
                          {run.item_number || '—'}
                        </td>

                        <td className='px-4 py-4'>
                          {run.notice_id || '—'}
                        </td>

                        <td className='px-4 py-4 text-muted-foreground'>
                          {run.notice_type || '—'}
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
                          {run.supervity_run_id ? (
                            <span
                              className='block max-w-[230px] truncate font-mono text-xs'
                              title={run.supervity_run_id}
                            >
                              {run.supervity_run_id}
                            </span>
                          ) : (
                            <span className='text-muted-foreground'>
                              —
                            </span>
                          )}
                        </td>

                        <td className='px-4 py-4 text-muted-foreground'>
                          {new Date(
                            run.triggered_at
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