'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { useAI } from '@/context/AIContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Icons, type Icon } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { MarkdownContent } from '@/components/ai/MarkdownContent'
import { ToolActivityCards, type ToolActivity } from '@/components/ai/ToolActivityCards'

type Message = {
  id: number; conversation_id: string; role: 'user' | 'assistant'; content: string
  actor_email?: string | null; page_context?: string | null; grounded?: boolean | null
  refused?: boolean | null; tool_calls: ToolActivity[]; created_at?: string | null
}
type Conversation = {
  id: string; title: string; actor: string; updated_at?: string | null
  message_count: number; messages: Message[]
}
type Metrics = { conversations: number; actions: number; failures: number; grounded_answers: number; refusal_rate: number }
type HistoryResponse = { conversations: Conversation[]; total: number; limit: number; offset: number; metrics: Metrics }

const PAGE_SIZE = 10
const statusOptions = [
  ['all', 'All outcomes'], ['grounded', 'Grounded'], ['refused', 'Refused safely'],
  ['actions', 'Actions taken'], ['failures', 'Failed actions'],
]
const toolOptions = [
  ['', 'All tools'], ['list_policies', 'Policy lookup'], ['create_policy', 'Policy creation'],
  ['get_run', 'Run lookup'], ['get_recent_runs', 'Recent runs'], ['trigger_operator', 'Operator trigger'],
]

export default function AIManagerHistoryPage() {
  const { openManager, startNewConversation } = useAI()
  const [data, setData] = useState<HistoryResponse>({ conversations: [], total: 0, limit: PAGE_SIZE, offset: 0, metrics: { conversations: 0, actions: 0, failures: 0, grounded_answers: 0, refusal_rate: 0 } })
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [actor, setActor] = useState('')
  const [status, setStatus] = useState('all')
  const [tool, setTool] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedSearch(search); setPage(0) }, 350)
    return () => window.clearTimeout(timer)
  }, [search])

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true); setError('')
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), status })
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (actor) params.set('actor', actor)
      if (tool) params.set('tool', tool)
      if (dateFrom) params.set('date_from', `${dateFrom}T00:00:00`)
      if (dateTo) params.set('date_to', `${dateTo}T23:59:59`)
      const response = await apiClient.get<HistoryResponse>(`/api/ai/history/conversations?${params}`)
      setData(response)
      setSelectedId(current => response.conversations.some(item => item.id === current) ? current : (response.conversations[0]?.id || ''))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AI Manager history.')
    } finally { setLoading(false) }
  }, [actor, dateFrom, dateTo, debouncedSearch, page, status, tool])

  useEffect(() => { loadHistory() }, [loadHistory])
  const selected = data.conversations.find(item => item.id === selectedId) || data.conversations[0]
  const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  const metricCards: Array<{ label: string; value: string | number; icon: Icon; style: string }> = [
    { label: 'Conversations', value: data.metrics.conversations, icon: Icons.messageSquare, style: 'text-blue-700 bg-blue-50' },
    { label: 'Grounded answers', value: data.metrics.grounded_answers, icon: Icons.checkCircle, style: 'text-emerald-700 bg-emerald-50' },
    { label: 'Actions triggered', value: data.metrics.actions, icon: Icons.zap, style: 'text-purple-700 bg-purple-50' },
    { label: 'Tool failures', value: data.metrics.failures, icon: Icons.alertTriangle, style: 'text-red-700 bg-red-50' },
    { label: 'Refusal rate', value: `${data.metrics.refusal_rate}%`, icon: Icons.shield, style: 'text-amber-700 bg-amber-50' },
  ]
  const newChat = () => { startNewConversation(); openManager() }
  const clearFilters = () => { setSearch(''); setDebouncedSearch(''); setActor(''); setStatus('all'); setTool(''); setDateFrom(''); setDateTo(''); setPage(0) }

  return <div className='space-y-6'>
    <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
      <div><div className='mb-2 flex items-center gap-2 text-sm font-semibold text-brand-cornflower'><Icons.sparkles className='h-4 w-4' />AI operations</div>
        <h1 className='text-display-3 font-bold tracking-tight text-brand-navy lg:text-display-2'>AI Manager</h1>
        <p className='mt-2 text-lg text-muted-foreground'>Search conversations, review outcomes, and audit assistant actions.</p></div>
      <div className='flex gap-2'><Button variant='outline' onClick={loadHistory} disabled={loading}><Icons.refresh className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />Refresh</Button><Button variant='gradient' onClick={newChat}><Icons.plus className='mr-2 h-4 w-4' />New conversation</Button></div>
    </div>

    <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-5'>
      {metricCards.map(({ label, value, icon: MetricIcon, style }) => <Card key={label}><CardContent className='flex items-center gap-3 p-4'><div className={cn('rounded-xl p-2', style)}><MetricIcon className='h-5 w-5' /></div><div><p className='text-xs text-muted-foreground'>{label}</p><p className='text-xl font-bold text-brand-navy'>{value}</p></div></CardContent></Card>)}
    </div>

    <Card><CardContent className='p-4'>
      <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,2fr)_1fr_1fr_1fr_1fr_auto]'>
        <label className='relative'><Icons.search className='absolute left-3 top-3 h-4 w-4 text-muted-foreground' /><input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search message, run, notice, or user' className='h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm outline-none focus:border-brand-cornflower' /></label>
        <input value={actor} onChange={e => { setActor(e.target.value); setPage(0) }} placeholder='User email' className='h-10 rounded-lg border border-border bg-white px-3 text-sm outline-none focus:border-brand-cornflower' />
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(0) }} className='h-10 rounded-lg border border-border bg-white px-3 text-sm'>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select value={tool} onChange={e => { setTool(e.target.value); setPage(0) }} className='h-10 rounded-lg border border-border bg-white px-3 text-sm'>{toolOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <div className='flex gap-2'><input type='date' aria-label='From date' value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }} className='h-10 min-w-0 rounded-lg border border-border bg-white px-2 text-xs' /><input type='date' aria-label='To date' value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }} className='h-10 min-w-0 rounded-lg border border-border bg-white px-2 text-xs' /></div>
        <Button variant='ghost' onClick={clearFilters}>Clear</Button>
      </div>
    </CardContent></Card>

    {error && <div className='rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700'>{error}</div>}
    <Card className='overflow-hidden'><CardContent className='p-0'>
      {loading && !data.conversations.length ? <div className='flex justify-center py-24'><Icons.loader className='h-8 w-8 animate-spin text-brand-cornflower' /></div>
      : !data.conversations.length ? <div className='py-24 text-center'><Icons.filter className='mx-auto h-12 w-12 text-muted-foreground/40' /><h3 className='mt-4 font-semibold text-brand-navy'>No matching conversations</h3><p className='mt-1 text-sm text-muted-foreground'>Adjust the filters or start a new conversation.</p></div>
      : <div className='grid min-h-[600px] lg:grid-cols-[320px_1fr]'>
        <aside className='border-b border-border bg-muted/20 lg:border-b-0 lg:border-r'>
          <div className='border-b border-border p-4'><p className='font-semibold text-brand-navy'>Conversations</p><p className='text-xs text-muted-foreground'>{data.total} matching threads</p></div>
          <div className='max-h-[490px] overflow-y-auto p-2'>{data.conversations.map(item => <button key={item.id} onClick={() => setSelectedId(item.id)} className={cn('mb-1 w-full rounded-xl p-3 text-left transition-colors', selected?.id === item.id ? 'bg-brand-navy text-white' : 'hover:bg-white')}><p className='truncate text-sm font-semibold'>{item.title}</p><p className={cn('mt-1 truncate text-xs', selected?.id === item.id ? 'text-white/65' : 'text-muted-foreground')}>{item.actor} · {item.message_count} messages</p><p className={cn('mt-2 text-[11px]', selected?.id === item.id ? 'text-white/50' : 'text-muted-foreground')}>{item.updated_at ? new Date(item.updated_at).toLocaleString() : ''}</p></button>)}</div>
          <div className='flex items-center justify-between border-t border-border p-3'><Button size='sm' variant='ghost' disabled={page === 0} onClick={() => setPage(value => value - 1)}><Icons.chevronLeft className='h-4 w-4' /></Button><span className='text-xs text-muted-foreground'>Page {page + 1} of {pageCount}</span><Button size='sm' variant='ghost' disabled={page + 1 >= pageCount} onClick={() => setPage(value => value + 1)}><Icons.chevronRight className='h-4 w-4' /></Button></div>
        </aside>
        <section className='min-w-0'><div className='flex items-center justify-between border-b border-border px-5 py-4'><div className='min-w-0'><h2 className='truncate font-semibold text-brand-navy'>{selected?.title}</h2><p className='text-xs text-muted-foreground'>{selected?.actor}</p></div><Button size='sm' variant='outline' onClick={openManager}><Icons.messageSquare className='mr-2 h-4 w-4' />Open chat</Button></div>
          <div className='max-h-[540px] space-y-4 overflow-y-auto p-5'>{selected?.messages.map(message => <div key={message.id} className={cn('rounded-2xl border p-4', message.role === 'user' ? 'ml-auto max-w-[85%] border-brand-navy/10 bg-brand-navy text-white' : 'mr-auto max-w-[92%] border-border bg-muted/30')}><div className='mb-2 flex flex-wrap items-center gap-2 text-xs'><span className='font-semibold'>{message.role === 'user' ? (message.actor_email || 'User') : 'AutoPilot AI'}</span>{message.role === 'assistant' && message.grounded && <span className='rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700'>Grounded</span>}{message.role === 'assistant' && message.refused && <span className='rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700'>Refused safely</span>}<span className={cn('ml-auto', message.role === 'user' ? 'text-white/60' : 'text-muted-foreground')}>{message.created_at ? new Date(message.created_at).toLocaleString() : ''}</span></div>{message.role === 'assistant' ? <MarkdownContent content={message.content} /> : <p className='whitespace-pre-wrap text-sm leading-6'>{message.content}</p>}{message.role === 'assistant' && <ToolActivityCards calls={message.tool_calls} />}{message.page_context && <p className={cn('mt-2 text-xs', message.role === 'user' ? 'text-white/60' : 'text-muted-foreground')}>From {message.page_context}</p>}</div>)}</div>
        </section>
      </div>}
    </CardContent></Card>
  </div>
}
