'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'

import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Icons } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

type ReviewStatus = 'pending' | 'approved' | 'modified' | 'rejected' | 'resumed'
type Decision = 'approve' | 'modify' | 'reject'

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
type StatusFilter = 'pending' | 'approved' | 'modified' | 'rejected' | 'resumed' | 'all'

const filters: Array<{ value: StatusFilter; label: string }> = [
  { value: 'pending', label: 'Needs review' },
  { value: 'approved', label: 'Approved' },
  { value: 'modified', label: 'Modified' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'resumed', label: 'Resumed' },
  { value: 'all', label: 'All' },
]

function formatStatus(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function statusClasses(status: string) {
  if (status === 'approved' || status === 'resumed') return 'bg-emerald-100 text-emerald-700'
  if (status === 'rejected') return 'bg-red-100 text-red-700'
  if (status === 'modified') return 'bg-blue-100 text-blue-700'
  return 'bg-amber-100 text-amber-800'
}

export default function WorkbenchPage() {
  const [items, setItems] = useState<WorkbenchItem[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState<Decision | 'resume' | null>(null)
  const [showModify, setShowModify] = useState(false)
  const [notes, setNotes] = useState('')
  const [itemNumber, setItemNumber] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [noticeType, setNoticeType] = useState('')

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId]
  )

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
    setItemNumber(selected.disruption.item_number ?? '')
    setSupplierId(selected.disruption.notice_supplier_id ?? '')
    setNoticeType(selected.disruption.notice_type ?? '')
    setShowModify(false)
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(decision: Decision) {
    if (!selected) return
    if (decision === 'modify' && !itemNumber.trim() && !supplierId.trim() && !noticeType.trim()) {
      toast.error('Change at least one disruption field before submitting.')
      return
    }

    try {
      setSubmitting(decision)
      await apiClient.post(`/api/workbench/${selected.id}/decision`, {
        decision,
        decision_notes: notes.trim() || undefined,
        ...(decision === 'modify' ? {
          item_number: itemNumber.trim() || undefined,
          notice_supplier_id: supplierId.trim() || undefined,
          notice_type: noticeType.trim() || undefined,
        } : {}),
      })
      toast.success(decision === 'approve' ? 'Approved for continuation.' : decision === 'reject' ? 'Request rejected.' : 'Changes saved and approved.')
      await loadItems()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Decision could not be saved.')
    } finally {
      setSubmitting(null)
    }
  }

  async function resume() {
    if (!selected) return
    try {
      setSubmitting('resume')
      await apiClient.post(`/api/workbench/${selected.id}/resume`)
      toast.success('The approved workflow completed successfully.')
      await loadItems()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Workflow could not be resumed.')
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
        <Button variant='outline' onClick={() => loadItems()} disabled={loading}>
          <Icons.refresh className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} /> Refresh queue
        </Button>
      </div>

      <div className='flex flex-wrap gap-2'>
        {filters.map((entry) => (
          <Button key={entry.value} size='sm' variant={filter === entry.value ? 'default' : 'outline'} onClick={() => selectFilter(entry.value)}>
            {entry.label}
          </Button>
        ))}
      </div>

      {error && <div className='rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700'>{error}</div>}

      <div className='grid min-h-[560px] gap-5 lg:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.4fr)]'>
        <Card className='overflow-hidden'>
          <CardHeader className='border-b bg-slate-50/70'>
            <div className='flex items-center justify-between'>
              <CardTitle className='text-lg'>{filters.find((entry) => entry.value === filter)?.label}</CardTitle>
              <span className='rounded-full bg-brand-navy px-2.5 py-1 text-xs font-bold text-white'>{items.length}</span>
            </div>
          </CardHeader>
          <CardContent className='max-h-[650px] space-y-2 overflow-y-auto p-3'>
            {loading ? (
              <div className='flex items-center justify-center py-16 text-muted-foreground'><Icons.loader className='mr-2 h-5 w-5 animate-spin' /> Loading reviews...</div>
            ) : items.length === 0 ? (
              <div className='px-5 py-16 text-center'>
                <Icons.checkCircle className='mx-auto h-10 w-10 text-emerald-500' />
                <p className='mt-3 font-semibold text-brand-navy'>Queue is clear</p>
                <p className='mt-1 text-sm text-muted-foreground'>There are no items in this view.</p>
              </div>
            ) : items.map((item) => (
              <button key={item.id} onClick={() => setSelectedId(item.id)} className={cn('w-full rounded-xl border p-4 text-left transition-colors', selected?.id === item.id ? 'border-brand-cornflower bg-blue-50/60 ring-1 ring-brand-cornflower' : 'hover:bg-slate-50')}>
                <div className='flex items-start justify-between gap-3'>
                  <div className='min-w-0'>
                    <p className='truncate font-semibold text-brand-navy'>{item.disruption.item_number || item.external_id}</p>
                    <p className='mt-1 truncate text-xs text-muted-foreground'>Notice {item.external_id}</p>
                  </div>
                  <span className={cn('shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase', statusClasses(item.status))}>{formatStatus(item.status)}</span>
                </div>
                <p className='mt-3 line-clamp-2 text-sm text-slate-600'>{item.reason}</p>
                <p className='mt-3 flex items-center gap-1 text-xs text-muted-foreground'><Icons.clock className='h-3.5 w-3.5' /> {new Date(item.created_at).toLocaleString()}</p>
              </button>
            ))}
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

                {selected.status === 'pending' && (
                  <>
                    {selected.agent_run_status === 'waiting_for_human' && (
                      <div className='rounded-xl border border-purple-200 bg-purple-50 p-4'>
                        <p className='font-semibold text-purple-900'>Human approval required</p>
                        <p className='mt-1 text-sm text-purple-800'>This orchestrator run is paused. The Workbench decision below controls whether it is rejected or allowed to continue.</p>
                      </div>
                    )}

                    <div>
                      <Label htmlFor='decision-notes'>Reviewer notes <span className='font-normal text-muted-foreground'>(optional)</span></Label>
                      <textarea id='decision-notes' value={notes} onChange={(event) => setNotes(event.target.value)} placeholder='Explain the decision for the audit trail...' className='mt-2 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-cornflower' />
                    </div>

                    {showModify && (
                      <div className='space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4'>
                        <div><p className='font-semibold text-brand-navy'>Modify disruption context</p><p className='text-sm text-muted-foreground'>Edit the values that should be sent when this workflow continues.</p></div>
                        <div className='grid gap-4 sm:grid-cols-2'>
                          <div><Label htmlFor='item-number'>Item number</Label><Input id='item-number' className='mt-1.5' value={itemNumber} onChange={(event) => setItemNumber(event.target.value)} /></div>
                          <div><Label htmlFor='supplier-id'>Supplier ID</Label><Input id='supplier-id' className='mt-1.5' value={supplierId} onChange={(event) => setSupplierId(event.target.value)} /></div>
                          <div className='sm:col-span-2'><Label htmlFor='notice-type'>Notice type</Label><Input id='notice-type' className='mt-1.5' value={noticeType} onChange={(event) => setNoticeType(event.target.value)} /></div>
                        </div>
                      </div>
                    )}

                    <div className='flex flex-col gap-3 border-t pt-5 sm:flex-row'>
                      <Button className='bg-emerald-600 hover:bg-emerald-700' onClick={() => decide('approve')} disabled={submitting !== null}><Icons.check className='mr-2 h-4 w-4' />{submitting === 'approve' ? 'Approving...' : 'Approve'}</Button>
                      <Button variant='outline' className='border-blue-300 text-blue-700 hover:bg-blue-50' onClick={() => showModify ? decide('modify') : setShowModify(true)} disabled={submitting !== null}><Icons.pencil className='mr-2 h-4 w-4' />{submitting === 'modify' ? 'Saving...' : showModify ? 'Save modification' : 'Modify'}</Button>
                      <Button variant='outline' className='border-red-300 text-red-700 hover:bg-red-50' onClick={() => decide('reject')} disabled={submitting !== null}><Icons.close className='mr-2 h-4 w-4' />{submitting === 'reject' ? 'Rejecting...' : 'Reject'}</Button>
                    </div>
                  </>
                )}

                {(selected.status === 'approved' || selected.status === 'modified') && (
                  <div className='rounded-xl border border-emerald-200 bg-emerald-50 p-4'>
                    <p className='font-semibold text-emerald-900'>Human review complete</p>
                    <p className='mt-1 text-sm text-emerald-800'>{selected.decision_notes || 'This workflow is cleared to continue.'}</p>
                    <Button className='mt-4' onClick={resume} disabled={submitting !== null}><Icons.zap className='mr-2 h-4 w-4' />{submitting === 'resume' ? 'Running workflow...' : 'Resume approved workflow'}</Button>
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
