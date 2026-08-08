'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'

import { apiClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

type Policy = {
  id: number; name: string; policy_type: string; description: string | null
  threshold_value: number | null; enabled: boolean; status: string; version: number
  field_name: string | null; operator: string; unit: string | null; action: string
  scope: Record<string, unknown>; fail_mode: string; priority: number
  effective_from: string | null; effective_until: string | null
  updated_by: string | null; updated_at: string | null; plain_language: string
}
type Metrics = { total: number; active: number; runs_evaluated: number; runs_blocked: number; block_rate: number; errors: number; top_blocker: { name: string; count: number } | null }
type Evaluation = { id: number; policy_id: number | null; policy_name: string; policy_version: number | null; outcome: string; reason: string | null; input_field: string | null; input_value: string | null; operator: string | null; threshold_value: number | null; calculation: string | null; final_effect: string | null; duration_ms: number | null }
type EvaluationRun = { run_id: number; final_decision: string; passed: number; total: number; blocked_by: string[]; evaluated_at: string; evaluations: Evaluation[] }
type EvaluationResponse = { page: number; page_size: number; total: number; runs: EvaluationRun[] }
type Simulation = { runs_tested: number; would_block: number; block_rate: number; errors: number; results: Array<{ run_id: number; outcome: string; calculation: string | null; reason: string }> }
type History = { versions: Array<{ id: number; version: number; reason: string; actor: string | null; created_at: string }>; audit: Array<{ id: number; action: string; from_version: number | null; to_version: number | null; reason: string; actor: string | null; created_at: string }> }

const TYPE_DEFAULTS: Record<string, Partial<Policy>> = {
  severity_threshold: { field_name: 'severity', operator: 'gt', unit: 'score_10', threshold_value: 7 },
  expedite_spend_limit: { field_name: 'expedite_cost', operator: 'gt', unit: 'USD', threshold_value: 10000 },
  contract_clause_block: { field_name: 'x_escalation_clause', operator: 'not_empty', unit: null, threshold_value: null },
}
const emptyDraft = { name: '', policy_type: 'severity_threshold', description: '', threshold_value: '7', field_name: 'severity', operator: 'gt', unit: 'score_10', scopeKey: '', scopeValue: '', fail_mode: 'closed', priority: '100', change_reason: '' }

function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: string }) {
  const styles: Record<string, string> = { green: 'bg-emerald-100 text-emerald-700', red: 'bg-red-100 text-red-700', amber: 'bg-amber-100 text-amber-700', blue: 'bg-blue-100 text-blue-700', gray: 'bg-gray-100 text-gray-700' }
  return <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold uppercase', styles[tone] || styles.gray)}>{children}</span>
}

export default function PoliciesPage() {
  const { data: session } = useSession()
  const actor = session?.user?.email || 'dev@autopilot.local'
  // AUTH_BYPASS development sessions are represented as Dev User even when
  // NextAuth has not issued a browser cookie. The API remains the authority
  // and independently enforces the admin role on every mutation.
  const isAdmin = session?.roles?.includes('admin') || actor === 'dev@autopilot.local'
  const [tab, setTab] = useState<'policies' | 'evaluations' | 'simulations' | 'history'>('policies')
  const [policies, setPolicies] = useState<Policy[]>([])
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [evaluationData, setEvaluationData] = useState<EvaluationResponse>({ page: 1, page_size: 20, total: 0, runs: [] })
  const [expandedRun, setExpandedRun] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [outcome, setOutcome] = useState('all')
  const [page, setPage] = useState(1)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Policy | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [simulationOpen, setSimulationOpen] = useState(false)
  const [simulationPolicy, setSimulationPolicy] = useState<Policy | null>(null)
  const [simulation, setSimulation] = useState<Simulation | null>(null)
  const [historyPolicy, setHistoryPolicy] = useState<Policy | null>(null)
  const [history, setHistory] = useState<History | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const query = new URLSearchParams({ page: String(page), page_size: '20', outcome })
      if (search.trim()) query.set('search', search.trim())
      const [policyResult, metricResult, evaluations] = await Promise.all([
        apiClient.get<{ policies: Policy[] }>('/api/policies'),
        apiClient.get<Metrics>('/api/policies/metrics'),
        apiClient.get<EvaluationResponse>(`/api/policies/evaluations?${query}`),
      ])
      setPolicies(policyResult.policies); setMetrics(metricResult); setEvaluationData(evaluations)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load policy governance') }
    finally { setLoading(false) }
  }, [outcome, page, search])
  useEffect(() => { load() }, [load])

  const activePolicies = useMemo(() => policies.filter(p => p.status !== 'archived'), [policies])
  const openCreate = () => { setEditing(null); setDraft(emptyDraft); setEditorOpen(true) }
  const openEdit = (policy: Policy) => {
    setEditing(policy)
    const scopeEntry = Object.entries(policy.scope || {})[0]
    setDraft({ name: policy.name, policy_type: policy.policy_type, description: policy.description || '', threshold_value: policy.threshold_value === null ? '' : String(policy.threshold_value), field_name: policy.field_name || '', operator: policy.operator, unit: policy.unit || '', scopeKey: scopeEntry?.[0] || '', scopeValue: scopeEntry ? String(scopeEntry[1]) : '', fail_mode: policy.fail_mode, priority: String(policy.priority), change_reason: '' })
    setEditorOpen(true)
  }
  const changeType = (type: string) => {
    const defaults = TYPE_DEFAULTS[type]
    setDraft(current => ({ ...current, policy_type: type, field_name: defaults.field_name || '', operator: defaults.operator || 'gt', unit: defaults.unit || '', threshold_value: defaults.threshold_value === null ? '' : String(defaults.threshold_value ?? '') }))
  }
  const payload = () => ({
    name: draft.name, policy_type: draft.policy_type, description: draft.description || null,
    threshold_value: draft.operator === 'not_empty' ? null : Number(draft.threshold_value),
    field_name: draft.field_name, operator: draft.operator, unit: draft.unit || null,
    action: 'block', scope: draft.scopeKey && draft.scopeValue ? { [draft.scopeKey]: draft.scopeValue } : {},
    fail_mode: draft.fail_mode, priority: Number(draft.priority), actor,
    change_reason: draft.change_reason || (editing ? 'Policy configuration updated' : 'Policy draft created'),
  })
  const save = async () => {
    if (!draft.name.trim()) return setError('Policy name is required.')
    setBusy(true); setError('')
    try {
      const result = editing
        ? await apiClient.patch<{ message: string }>(`/api/policies/${editing.id}`, payload())
        : await apiClient.post<{ message: string }>('/api/policies', { ...payload(), status: 'draft' })
      setMessage(result.message); setEditorOpen(false); await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to save policy') }
    finally { setBusy(false) }
  }
  const lifecycle = async (policy: Policy, status: string) => {
    const reason = window.prompt(`Reason for moving this policy to ${status}:`)
    if (!reason) return
    setBusy(true)
    try { const result = await apiClient.post<{ message: string }>(`/api/policies/${policy.id}/lifecycle/${status}`, { actor, reason }); setMessage(result.message); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Lifecycle change failed') }
    finally { setBusy(false) }
  }
  const duplicate = async (policy: Policy) => {
    setBusy(true)
    try { const result = await apiClient.post<{ message: string }>(`/api/policies/${policy.id}/duplicate`, { actor, reason: 'Duplicated for safe editing' }); setMessage(result.message); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Duplicate failed') }
    finally { setBusy(false) }
  }
  const deletePolicy = async (policy: Policy) => {
    const confirmed = window.confirm(
      `Delete "${policy.name}" permanently?\n\nOnly unused, inactive policies can be deleted. Policies with evaluation history must be archived.`
    )
    if (!confirmed) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await apiClient.delete<{ message: string }>(`/api/policies/${policy.id}`)
      setMessage(result.message); await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Delete failed') }
    finally { setBusy(false) }
  }
  const runSimulation = async (policy: Policy) => {
    setSimulationPolicy(policy); setSimulationOpen(true); setSimulation(null); setBusy(true)
    try { setSimulation(await apiClient.post<Simulation>('/api/policies/simulate', { policy_id: policy.id, limit: 50 })) }
    catch (err) { setError(err instanceof Error ? err.message : 'Simulation failed') }
    finally { setBusy(false) }
  }
  const openHistory = async (policy: Policy) => {
    setHistoryPolicy(policy); setHistory(null); setTab('history')
    try { setHistory(await apiClient.get<History>(`/api/policies/${policy.id}/history`)) }
    catch (err) { setError(err instanceof Error ? err.message : 'History failed') }
  }
  const rollback = async (version: number) => {
    if (!historyPolicy) return
    const reason = window.prompt(`Reason for restoring version ${version}:`)
    if (!reason) return
    await apiClient.post(`/api/policies/${historyPolicy.id}/rollback/${version}`, { actor, reason })
    setMessage(`Version ${version} restored as a new version.`); await load(); await openHistory(historyPolicy)
  }
  const exportEvaluations = () => {
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
    window.open(`${base}${basePath}/api/policies/evaluations/export`, '_blank', 'noopener,noreferrer')
  }

  if (loading && !metrics) return <div><h1 className='text-3xl font-bold text-brand-navy'>AI Policies</h1><p className='mt-2 text-muted-foreground'>Loading governance workspace…</p></div>

  return <div className='space-y-6'>
    <div className='flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between'>
      <div><h1 className='text-3xl font-bold tracking-tight text-brand-navy'>AI Policies</h1><p className='mt-2 text-muted-foreground'>Design, test, activate, and audit the rules governing orchestration.</p></div>
      <div className='flex flex-wrap gap-2'><Button variant='outline' onClick={load}>Refresh</Button><Button variant='outline' onClick={() => setTab('simulations')}>Simulation workspace</Button>{isAdmin && <Button onClick={openCreate}>Add policy</Button>}</div>
    </div>
    {!isAdmin && <div className='rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800'>Policy configuration is read-only. Administrator access is required to add, modify, activate, archive, or delete policies.</div>}
    {message && <div className='rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700'>{message}</div>}
    {error && <div className='rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'>{error}</div>}

    <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-6'>
      {[
        ['Active policies', metrics?.active ?? 0], ['Runs evaluated', metrics?.runs_evaluated ?? 0],
        ['Runs blocked', metrics?.runs_blocked ?? 0], ['Block rate', `${metrics?.block_rate ?? 0}%`],
        ['Evaluation errors', metrics?.errors ?? 0], ['Top blocker', metrics?.top_blocker?.name || 'None'],
      ].map(([label, value]) => <Card key={String(label)}><CardContent className='p-4'><p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{label}</p><p className='mt-2 truncate text-2xl font-bold text-brand-navy' title={String(value)}>{value}</p></CardContent></Card>)}
    </div>

    <div className='flex flex-wrap gap-2 border-b pb-3'>
      {(['policies', 'evaluations', 'simulations', 'history'] as const).map(item => <Button key={item} variant={tab === item ? 'default' : 'ghost'} onClick={() => setTab(item)} className='capitalize'>{item === 'history' ? 'Change history' : item}</Button>)}
    </div>

    {tab === 'policies' && <div className='grid gap-4 xl:grid-cols-2'>
      {activePolicies.map(policy => <Card key={policy.id} className='overflow-hidden'>
        <CardHeader className='space-y-3'>
          <div className='flex items-start justify-between gap-3'><div><CardTitle>{policy.name}</CardTitle><p className='mt-1 text-sm text-muted-foreground'>{policy.description}</p></div><Badge tone={policy.status === 'active' ? 'green' : policy.status === 'draft' ? 'gray' : 'amber'}>{policy.status}</Badge></div>
          <div className='rounded-xl bg-brand-navy/[0.04] p-3 text-sm font-medium text-brand-navy'>{policy.plain_language}</div>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid grid-cols-2 gap-3 text-sm'><div><span className='text-muted-foreground'>Version</span><p className='font-semibold'>v{policy.version}</p></div><div><span className='text-muted-foreground'>Failure mode</span><p className='font-semibold capitalize'>Fail {policy.fail_mode}</p></div><div><span className='text-muted-foreground'>Field</span><p className='font-mono text-xs'>{policy.field_name}</p></div><div><span className='text-muted-foreground'>Scope</span><p className='truncate font-semibold'>{Object.keys(policy.scope || {}).length ? JSON.stringify(policy.scope) : 'All runs'}</p></div></div>
          <div className='flex flex-wrap gap-2'>{isAdmin && <><Button size='sm' onClick={() => openEdit(policy)}>Modify</Button><Button size='sm' variant='outline' onClick={() => runSimulation(policy)}>Simulate</Button>{policy.status !== 'active' && <Button size='sm' variant='outline' onClick={() => lifecycle(policy, 'active')} disabled={busy}>Activate</Button>}{policy.status === 'active' && <Button size='sm' variant='outline' onClick={() => lifecycle(policy, 'draft')} disabled={busy}>Deactivate</Button>}<Button size='sm' variant='ghost' onClick={() => duplicate(policy)}>Duplicate</Button><Button size='sm' variant='ghost' onClick={() => lifecycle(policy, 'archived')}>Archive</Button><Button size='sm' variant='ghost' className='text-red-600 hover:bg-red-50 hover:text-red-700' disabled={busy || policy.status === 'active'} onClick={() => deletePolicy(policy)}>Delete</Button></>}<Button size='sm' variant='ghost' onClick={() => openHistory(policy)}>History</Button></div>
          <p className='text-xs text-muted-foreground'>Last changed {policy.updated_at ? new Date(policy.updated_at).toLocaleString() : '—'} by {policy.updated_by || 'system'}</p>
        </CardContent>
      </Card>)}
    </div>}

    {tab === 'evaluations' && <Card><CardHeader><CardTitle>Policy evaluation runs</CardTitle><p className='text-sm text-muted-foreground'>One row per orchestration run. Expand for evidence and exact calculations.</p></CardHeader><CardContent>
      <div className='mb-4 flex flex-wrap gap-2'><Input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder='Search policy or reason…' className='max-w-sm'/><select value={outcome} onChange={e => { setOutcome(e.target.value); setPage(1) }} className='rounded-lg border bg-white px-3 text-sm'><option value='all'>All outcomes</option><option value='block'>Blocked</option><option value='pass'>Passed</option><option value='error'>Errors</option><option value='not_applicable'>Not applicable</option><option value='skipped'>Skipped</option></select><Button variant='outline' onClick={exportEvaluations}>Export CSV</Button></div>
      <div className='space-y-2'>{evaluationData.runs.map(run => <div key={run.run_id} className='rounded-xl border'>
        <button className='grid w-full grid-cols-[80px_1fr_auto_auto] items-center gap-3 p-4 text-left' onClick={() => setExpandedRun(expandedRun === run.run_id ? null : run.run_id)}><span className='font-mono font-bold'>#{run.run_id}</span><span><Badge tone={run.final_decision === 'blocked' ? 'red' : 'green'}>{run.final_decision}</Badge>{run.blocked_by.length > 0 && <span className='ml-2 text-xs text-muted-foreground'>by {run.blocked_by.join(', ')}</span>}</span><span className='text-sm'>{run.passed}/{run.total} passed</span><span className='text-xs text-muted-foreground'>{new Date(run.evaluated_at).toLocaleString()}</span></button>
        {expandedRun === run.run_id && <div className='border-t bg-gray-50/60 p-4'><div className='space-y-3'>{run.evaluations.map(item => <div key={item.id} className='rounded-lg border bg-white p-3'><div className='flex flex-wrap items-center gap-2'><strong>{item.policy_name} v{item.policy_version || '?'}</strong><Badge tone={item.outcome === 'block' || item.outcome === 'error' ? 'red' : item.outcome === 'pass' ? 'green' : 'amber'}>{item.outcome}</Badge><span className='ml-auto text-xs text-muted-foreground'>{item.duration_ms ?? 0} ms</span></div><p className='mt-2 font-mono text-sm text-brand-navy'>{item.calculation || item.reason}</p><p className='mt-1 text-sm text-muted-foreground'>{item.reason} · {item.final_effect}</p></div>)}</div></div>}
      </div>)}</div>
      <div className='mt-4 flex items-center justify-between text-sm'><span>{evaluationData.total} runs</span><div className='flex gap-2'><Button size='sm' variant='outline' disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button><span className='px-2 py-2'>Page {page}</span><Button size='sm' variant='outline' disabled={page * 20 >= evaluationData.total} onClick={() => setPage(p => p + 1)}>Next</Button></div></div>
    </CardContent></Card>}

    {tab === 'simulations' && <Card><CardHeader><CardTitle>Historical simulation</CardTitle><p className='text-sm text-muted-foreground'>Test a policy against recent disruptions without changing production behavior.</p></CardHeader><CardContent><div className='grid gap-3 md:grid-cols-3'>{activePolicies.map(policy => <button key={policy.id} onClick={() => runSimulation(policy)} className='rounded-xl border p-4 text-left transition hover:border-brand-cornflower hover:bg-brand-cornflower/5'><strong>{policy.name}</strong><p className='mt-1 text-sm text-muted-foreground'>{policy.plain_language}</p><span className='mt-3 inline-block text-sm font-semibold text-brand-cornflower'>Run simulation →</span></button>)}</div></CardContent></Card>}

    {tab === 'history' && <Card><CardHeader><CardTitle>Change history {historyPolicy ? `— ${historyPolicy.name}` : ''}</CardTitle><p className='text-sm text-muted-foreground'>Select History on a policy to inspect versions, actors, reasons, and rollback options.</p></CardHeader><CardContent>{!history ? <p className='py-10 text-center text-muted-foreground'>No policy selected.</p> : <div className='space-y-3'>{history.audit.map(event => <div key={event.id} className='flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-center'><div className='flex-1'><div className='flex items-center gap-2'><Badge tone='blue'>{event.action}</Badge><strong>v{event.from_version ?? '—'} → v{event.to_version ?? '—'}</strong></div><p className='mt-2 text-sm'>{event.reason}</p><p className='mt-1 text-xs text-muted-foreground'>{event.actor || 'system'} · {new Date(event.created_at).toLocaleString()}</p></div>{event.from_version && <Button size='sm' variant='outline' onClick={() => rollback(event.from_version!)}>Restore v{event.from_version}</Button>}</div>)}</div>}</CardContent></Card>}

    <Dialog open={editorOpen} onOpenChange={setEditorOpen}><DialogContent className='max-h-[90vh] max-w-2xl overflow-y-auto'><DialogHeader><DialogTitle>{editing ? `Edit ${editing.name}` : 'Create policy draft'}</DialogTitle><DialogDescription>Define the business rule clearly. Changes remain a draft until simulated and activated.</DialogDescription></DialogHeader>
      <div className='grid gap-4 py-2 sm:grid-cols-2'><label className='space-y-1 text-sm'><span>Name</span><Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label><label className='space-y-1 text-sm'><span>Policy type</span><select value={draft.policy_type} onChange={e => changeType(e.target.value)} disabled={!!editing} className='h-10 w-full rounded-lg border bg-white px-3'><option value='severity_threshold'>Severity threshold</option><option value='expedite_spend_limit'>Expedite spend limit</option><option value='contract_clause_block'>Contract clause block</option></select></label><label className='space-y-1 text-sm sm:col-span-2'><span>Description</span><textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} className='min-h-20 w-full rounded-lg border p-3'/></label><label className='space-y-1 text-sm'><span>Input field</span><Input value={draft.field_name} onChange={e => setDraft({ ...draft, field_name: e.target.value })}/></label><label className='space-y-1 text-sm'><span>Comparison</span><select value={draft.operator} onChange={e => setDraft({ ...draft, operator: e.target.value })} className='h-10 w-full rounded-lg border bg-white px-3'><option value='gt'>Greater than</option><option value='gte'>At least</option><option value='lt'>Less than</option><option value='lte'>At most</option><option value='eq'>Equal to</option><option value='contains'>Contains</option><option value='not_empty'>Is present</option></select></label>{draft.operator !== 'not_empty' && <label className='space-y-1 text-sm'><span>Threshold</span><Input type='number' value={draft.threshold_value} onChange={e => setDraft({ ...draft, threshold_value: e.target.value })}/></label>}<label className='space-y-1 text-sm'><span>Unit</span><select value={draft.unit} onChange={e => setDraft({ ...draft, unit: e.target.value })} className='h-10 w-full rounded-lg border bg-white px-3'><option value=''>None</option><option value='USD'>USD</option><option value='score_10'>Score out of 10</option></select></label><label className='space-y-1 text-sm'><span>Scope field (optional)</span><Input placeholder='notice_type' value={draft.scopeKey} onChange={e => setDraft({ ...draft, scopeKey: e.target.value })}/></label><label className='space-y-1 text-sm'><span>Scope value</span><Input placeholder='supplier_delay' value={draft.scopeValue} onChange={e => setDraft({ ...draft, scopeValue: e.target.value })}/></label><label className='space-y-1 text-sm'><span>Missing data behavior</span><select value={draft.fail_mode} onChange={e => setDraft({ ...draft, fail_mode: e.target.value })} className='h-10 w-full rounded-lg border bg-white px-3'><option value='closed'>Fail closed (block)</option><option value='open'>Fail open (allow)</option></select></label><label className='space-y-1 text-sm'><span>Priority</span><Input type='number' value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })}/></label><label className='space-y-1 text-sm sm:col-span-2'><span>Change reason</span><Input placeholder='Why is this policy being created or changed?' value={draft.change_reason} onChange={e => setDraft({ ...draft, change_reason: e.target.value })}/></label></div>
      <DialogFooter><Button variant='outline' onClick={() => setEditorOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save new version' : 'Create draft'}</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={simulationOpen} onOpenChange={setSimulationOpen}><DialogContent className='max-h-[90vh] max-w-3xl overflow-y-auto'><DialogHeader><DialogTitle>Simulation — {simulationPolicy?.name}</DialogTitle><DialogDescription>Read-only evaluation against up to 50 recent disruption records.</DialogDescription></DialogHeader>{busy && <p className='py-10 text-center'>Running simulation…</p>}{simulation && <div className='space-y-4'><div className='grid grid-cols-4 gap-2'>{[['Runs tested', simulation.runs_tested], ['Would block', simulation.would_block], ['Block rate', `${simulation.block_rate}%`], ['Errors', simulation.errors]].map(([label, value]) => <div key={String(label)} className='rounded-xl bg-gray-50 p-3'><p className='text-xs text-muted-foreground'>{label}</p><p className='text-xl font-bold'>{value}</p></div>)}</div><div className='max-h-80 space-y-2 overflow-y-auto'>{simulation.results.map(result => <div key={result.run_id} className='flex items-center gap-3 rounded-lg border p-3'><span className='font-mono font-bold'>#{result.run_id}</span><Badge tone={result.outcome === 'block' || result.outcome === 'error' ? 'red' : 'green'}>{result.outcome}</Badge><span className='truncate text-sm'>{result.calculation || result.reason}</span></div>)}</div></div>}<DialogFooter><Button variant='outline' onClick={() => setSimulationOpen(false)}>Close</Button>{simulationPolicy?.status !== 'active' && simulation && simulation.errors === 0 && <Button onClick={() => { setSimulationOpen(false); lifecycle(simulationPolicy!, 'active') }}>Activate after review</Button>}</DialogFooter></DialogContent></Dialog>
  </div>
}
