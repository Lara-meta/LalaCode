'use client'

import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { apiClient } from '@/lib/api-client'


type Policy = {
  id: number
  name: string
  policy_type: string
  threshold_value: number | null
  enabled: boolean
}

type PolicyEvaluation = {
  id: number
  agent_run_id: number
  policy_name: string
  passed: boolean
  reason: string | null
  evaluated_at: string
}

type AgentRun = {
  id: number
  disruption_id: number
  supervity_run_id: string | null
  status: string
  triggered_at: string
  completed_at: string | null
}

type PoliciesResponse = {
  policies: Policy[]
}

type EvaluationsResponse = {
  evaluations: PolicyEvaluation[]
}

type RunsResponse = {
  runs: AgentRun[]
}

type PolicyUpdateResponse = {
  message: string
  policy: Policy
}




export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [evaluations, setEvaluations] = useState<PolicyEvaluation[]>([])
  const [runs, setRuns] = useState<AgentRun[]>([])  

  const [draftValues, setDraftValues] = useState<Record<number, string>>({})

  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<number | null>(null)

  const [message, setMessage] = useState('')
  const [error, setError] = useState('')


  // ============================================================
  // LOAD POLICIES + RECENT EVALUATIONS
  // ============================================================

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      const [policyData, evaluationData, runData] = await Promise.all([
  apiClient.get<PoliciesResponse>(
    '/api/policies'
  ),

  apiClient.get<EvaluationsResponse>(
    '/api/policies/evaluations/recent?limit=20'
  ),

  apiClient.get<RunsResponse>(
    '/api/orchestrator/runs/recent?limit=10'
  ),
])

setPolicies(policyData.policies)
setEvaluations(evaluationData.evaluations)
setRuns(runData.runs)
      const initialDrafts: Record<number, string> = {}

      policyData.policies.forEach((policy) => {
        if (policy.threshold_value !== null) {
          initialDrafts[policy.id] = String(policy.threshold_value)
        }
      })

      setDraftValues(initialDrafts)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load policy dashboard'
      )
    } finally {
      setLoading(false)
    }
  }, [])


  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])


  // ============================================================
  // SAVE THRESHOLD
  // ============================================================

  const saveThreshold = async (policy: Policy) => {
    const rawValue = draftValues[policy.id]

    if (rawValue === undefined || rawValue.trim() === '') {
      setError('Please enter a valid threshold value.')
      return
    }

    const value = Number(rawValue)

    if (Number.isNaN(value)) {
      setError('Threshold must be a number.')
      return
    }

    try {
      setSavingId(policy.id)
      setError('')
      setMessage('')

      const response =
        await apiClient.patch<PolicyUpdateResponse>(
          `/api/policies/${policy.id}`,
          {
            threshold_value: value,
          }
        )

      setPolicies((current) =>
        current.map((item) =>
          item.id === policy.id
            ? response.policy
            : item
        )
      )

      setMessage(
        `${response.policy.name} updated successfully.`
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to update policy'
      )
    } finally {
      setSavingId(null)
    }
  }


  // ============================================================
  // ENABLE / DISABLE POLICY
  // ============================================================

  const togglePolicy = async (
    policy: Policy,
    enabled: boolean
  ) => {
    try {
      setSavingId(policy.id)
      setError('')
      setMessage('')

      const response =
        await apiClient.patch<PolicyUpdateResponse>(
          `/api/policies/${policy.id}`,
          {
            enabled,
          }
        )

      setPolicies((current) =>
        current.map((item) =>
          item.id === policy.id
            ? response.policy
            : item
        )
      )

      setMessage(
        `${response.policy.name} ${
          enabled ? 'enabled' : 'disabled'
        }.`
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to update policy'
      )
    } finally {
      setSavingId(null)
    }
  }


  // ============================================================
  // LOADING STATE
  // ============================================================

  if (loading) {
    return (
      <div className='space-y-6'>
        <div>
          <h1 className='text-3xl font-bold text-brand-navy'>
            AI Policies
          </h1>

          <p className='mt-2 text-muted-foreground'>
            Loading policy configuration...
          </p>
        </div>
      </div>
    )
  }


  // ============================================================
  // PAGE
  // ============================================================

  return (
    <div className='space-y-8'>

      {/* ====================================================== */}
      {/* HEADER */}
      {/* ====================================================== */}

      <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>

        <div>
          <h1 className='text-3xl font-bold tracking-tight text-brand-navy'>
            AI Policies
          </h1>

          <p className='mt-2 text-muted-foreground'>
            Configure the rules evaluated before the
            disruption orchestrator is allowed to run.
          </p>
        </div>

        <Button
          variant='outline'
          onClick={loadDashboard}
        >
          Refresh
        </Button>
      </div>


      {/* ====================================================== */}
      {/* STATUS MESSAGE */}
      {/* ====================================================== */}

      {message && (
        <div className='rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700'>
          {message}
        </div>
      )}

      {error && (
        <div className='rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'>
          {error}
        </div>
      )}


      {/* ====================================================== */}
      {/* POLICY TABLE */}
      {/* ====================================================== */}

      <Card>
        <CardHeader>
          <CardTitle>
            Policy Configuration
          </CardTitle>

          <p className='text-sm text-muted-foreground'>
            Changes are stored in PostgreSQL and apply
            to the next orchestration request immediately.
          </p>
        </CardHeader>

        <CardContent>

          <div className='overflow-x-auto'>

            <table className='w-full text-left text-sm'>

              <thead>
                <tr className='border-b'>
                  <th className='px-4 py-3 font-semibold'>
                    Policy
                  </th>

                  <th className='px-4 py-3 font-semibold'>
                    Type
                  </th>

                  <th className='px-4 py-3 font-semibold'>
                    Value
                  </th>

                  <th className='px-4 py-3 font-semibold'>
                    Enabled
                  </th>

                  <th className='px-4 py-3 font-semibold'>
                    Action
                  </th>
                </tr>
              </thead>

              <tbody>

                {policies.map((policy) => (
                  <tr
                    key={policy.id}
                    className='border-b last:border-0'
                  >

                    {/* Policy name */}

                    <td className='px-4 py-4'>
                      <div className='font-medium text-brand-navy'>
                        {policy.name}
                      </div>

                      <div className='mt-1 text-xs text-muted-foreground'>
                        ID {policy.id}
                      </div>
                    </td>


                    {/* Type */}

                    <td className='px-4 py-4'>
                      <span className='rounded-full bg-gray-100 px-2.5 py-1 text-xs'>
                        {policy.policy_type}
                      </span>
                    </td>


                    {/* Threshold */}

                    <td className='px-4 py-4'>

                      {policy.threshold_value !== null ? (
                        <input
                          type='number'
                          value={
                            draftValues[policy.id] ?? ''
                          }
                          onChange={(event) =>
                            setDraftValues((current) => ({
                              ...current,
                              [policy.id]:
                                event.target.value,
                            }))
                          }
                          className='w-32 rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none transition focus:border-brand-cornflower focus:ring-2 focus:ring-brand-cornflower/20'
                        />
                      ) : (
                        <span className='text-muted-foreground'>
                          —
                        </span>
                      )}

                    </td>


                    {/* Enabled */}

                    <td className='px-4 py-4'>
                      <div className='flex items-center gap-3'>

                        <Switch
                          checked={policy.enabled}
                          disabled={
                            savingId === policy.id
                          }
                          onCheckedChange={(checked) =>
                            togglePolicy(
                              policy,
                              checked
                            )
                          }
                        />

                        <span
                          className={
                            policy.enabled
                              ? 'text-emerald-600'
                              : 'text-muted-foreground'
                          }
                        >
                          {policy.enabled
                            ? 'Enabled'
                            : 'Disabled'}
                        </span>

                      </div>
                    </td>


                    {/* Save */}

                    <td className='px-4 py-4'>

                      {policy.threshold_value !== null ? (
                        <Button
                          size='sm'
                          onClick={() =>
                            saveThreshold(policy)
                          }
                          disabled={
                            savingId === policy.id
                          }
                        >
                          {savingId === policy.id
                            ? 'Saving...'
                            : 'Save'}
                        </Button>
                      ) : (
                        <span className='text-xs text-muted-foreground'>
                          Toggle only
                        </span>
                      )}

                    </td>

                  </tr>
                ))}

              </tbody>
            </table>

          </div>

        </CardContent>
      </Card>


      {/* ====================================================== */}
      {/* RECENT POLICY EVALUATIONS */}
      {/* ====================================================== */}

      <Card>

        <CardHeader className='flex flex-row items-center justify-between'>

          <div>
            <CardTitle>
              Recent Policy Evaluations
            </CardTitle>

            <p className='mt-1 text-sm text-muted-foreground'>
              Results recorded before each orchestration run.
            </p>
          </div>

        </CardHeader>


        <CardContent>

          {evaluations.length === 0 ? (

            <p className='py-6 text-center text-sm text-muted-foreground'>
              No policy evaluations found.
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
                      Policy
                    </th>

                    <th className='px-4 py-3 font-semibold'>
                      Result
                    </th>

                    <th className='px-4 py-3 font-semibold'>
                      Reason
                    </th>

                    <th className='px-4 py-3 font-semibold'>
                      Evaluated
                    </th>

                  </tr>
                </thead>


                <tbody>

                  {evaluations.map((evaluation) => (

                    <tr
                      key={evaluation.id}
                      className='border-b last:border-0'
                    >

                      <td className='px-4 py-4 font-mono'>
                        {evaluation.agent_run_id}
                      </td>


                      <td className='px-4 py-4 font-medium'>
                        {evaluation.policy_name}
                      </td>


                      <td className='px-4 py-4'>

                        {evaluation.passed ? (

                          <span className='rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700'>
                            PASS
                          </span>

                        ) : (

                          <span className='rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700'>
                            BLOCK
                          </span>

                        )}

                      </td>


                      <td className='px-4 py-4 text-muted-foreground'>
                        {evaluation.reason || '—'}
                      </td>


                      <td className='px-4 py-4 text-muted-foreground'>
                        {new Date(
                          evaluation.evaluated_at
                        ).toLocaleString()}
                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>

          )}

        </CardContent>

      </Card>

      {/* ====================================================== */}
{/* RECENT ORCHESTRATION RUNS */}
{/* ====================================================== */}

<Card>

  <CardHeader>
    <CardTitle>
      Recent Orchestration Runs
    </CardTitle>

    <p className='mt-1 text-sm text-muted-foreground'>
      Recent orchestration attempts and their execution status.
    </p>
  </CardHeader>


  <CardContent>

    {runs.length === 0 ? (

      <p className='py-6 text-center text-sm text-muted-foreground'>
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
                Disruption
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

            {runs.map((run) => (

              <tr
                key={run.id}
                className='border-b last:border-0'
              >

                <td className='px-4 py-4 font-mono font-medium'>
                  {run.id}
                </td>


                <td className='px-4 py-4'>
                  {run.disruption_id}
                </td>


                <td className='px-4 py-4'>

                  {run.status === 'completed' ? (

                    <span className='rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700'>
                      COMPLETED
                    </span>

                  ) : run.status === 'blocked_by_policy' ? (

                    <span className='rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700'>
                      BLOCKED BY POLICY
                    </span>

                  ) : run.status === 'failed' ? (

                    <span className='rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700'>
                      FAILED
                    </span>

                  ) : (

                    <span className='rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700'>
                      {run.status
                        .replaceAll('_', ' ')
                        .toUpperCase()}
                    </span>

                  )}

                </td>


                <td className='px-4 py-4'>

                  {run.supervity_run_id ? (

                    <span
                      className='block max-w-[260px] truncate font-mono text-xs'
                      title={run.supervity_run_id}
                    >
                      {run.supervity_run_id}
                    </span>

                  ) : (

                    <span className='font-semibold text-red-500'>
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

            ))}

          </tbody>

        </table>

      </div>

    )}

  </CardContent>

</Card>

    </div>
  )
}