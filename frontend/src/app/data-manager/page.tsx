'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icons } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

type Integration = {
  id: number
  name: string
  provider: string
  category: string
  purpose: string
  configured: boolean
  enabled: boolean
  status: 'healthy' | 'configured' | 'degraded' | 'unhealthy' | 'not_configured' | 'disabled' | 'unknown'
  last_checked_at?: string | null
  last_error?: string | null
  missing_fields: string[]
}

type Response = {
  integrations: Integration[]
  summary: { total: number; configured: number; healthy: number; categories: string[]; round_two_gate_ready: boolean }
}

const statusTone: Record<string, string> = {
  healthy: 'bg-emerald-100 text-emerald-700',
  configured: 'bg-blue-100 text-blue-700',
  degraded: 'bg-amber-100 text-amber-800',
  unhealthy: 'bg-red-100 text-red-700',
  not_configured: 'bg-slate-100 text-slate-600',
  disabled: 'bg-slate-100 text-slate-500',
  unknown: 'bg-slate-100 text-slate-600',
}

const label = (value: string) => value.replaceAll('_', ' ')

export default function DataManagerPage() {
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { setError(''); setData(await apiClient.get<Response>('/api/integrations')) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load integrations.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const check = async () => {
    try {
      setChecking(true); setError('')
      setData(await apiClient.post<Response>('/api/integrations/check', {}))
    } catch (err) { setError(err instanceof Error ? err.message : 'Health check failed.') }
    finally { setChecking(false) }
  }

  const requiredTotal = data?.summary.total ?? 0
  const readyTotal = data?.summary.healthy ?? 0

  return <div className='space-y-6'>
    <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
      <div>
        <div className='mb-2 flex items-center gap-2 text-sm font-semibold text-brand-cornflower'><Icons.activity className='h-4 w-4' />Live systems</div>
        <h1 className='text-display-3 font-bold tracking-tight text-brand-navy lg:text-display-2'>Data Manager</h1>
        <p className='mt-2 text-lg text-muted-foreground'>Connected systems, operational purpose, and verified health.</p>
      </div>
      <Button onClick={check} disabled={checking || loading}><Icons.refresh className={cn('mr-2 h-4 w-4', checking && 'animate-spin')} />Check connections</Button>
    </div>

    {error && <div className='rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700'>{error}</div>}

    {data && <div className={cn('rounded-2xl border p-5', data.summary.round_two_gate_ready ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
      <div className='flex items-start gap-3'>
        {data.summary.round_two_gate_ready ? <Icons.checkCircle className='mt-0.5 h-5 w-5 text-emerald-700' /> : <Icons.alertTriangle className='mt-0.5 h-5 w-5 text-amber-700' />}
        <div><p className='font-semibold text-brand-navy'>{data.summary.round_two_gate_ready ? 'All required connections verified' : `${readyTotal} of ${requiredTotal} required connections ready`}</p>
          <p className='mt-1 text-sm text-muted-foreground'>{data.summary.round_two_gate_ready ? 'Supervity orchestration, Supabase procurement data, and Microsoft 365 human approval are ready.' : 'Complete the connection marked Not Configured, then run Check connections again.'}</p></div>
      </div>
    </div>}

    <div className='grid gap-4 lg:grid-cols-2'>
      {(data?.integrations || []).map(item => <Card key={item.id} className='overflow-hidden'>
        <CardHeader className='pb-3'><div className='flex items-start justify-between gap-3'><div><CardTitle>{item.name}</CardTitle><p className='mt-1 text-sm text-muted-foreground'>{item.provider}</p></div><span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold capitalize', statusTone[item.status])}>{label(item.status)}</span></div></CardHeader>
        <CardContent className='space-y-4'>
          <p className='text-sm leading-6'>{item.purpose}</p>
          <div className='grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm'><div><p className='text-xs text-muted-foreground'>Category</p><p className='mt-1 font-semibold capitalize'>{label(item.category)}</p></div><div><p className='text-xs text-muted-foreground'>Configuration</p><p className={cn('mt-1 font-semibold', item.configured ? 'text-emerald-700' : 'text-red-700')}>{item.configured ? 'Complete' : 'Incomplete'}</p></div></div>
          {item.last_error && <p className='rounded-lg bg-red-50 p-3 text-xs text-red-700'>{item.last_error}</p>}
          {!item.configured && item.missing_fields.length > 0 && <div className='rounded-lg border border-amber-200 bg-amber-50 p-3'><p className='text-xs font-semibold text-amber-900'>Add these server variables to .env</p><p className='mt-1 break-words font-mono text-[11px] text-amber-800'>{item.missing_fields.join(' · ')}</p></div>}
          <p className='text-xs text-muted-foreground'>{item.last_checked_at ? `Last checked ${new Date(item.last_checked_at).toLocaleString()}` : 'Not checked yet'}</p>
        </CardContent>
      </Card>)}
    </div>

    {loading && <Card><CardContent className='flex justify-center py-20'><Icons.refresh className='h-7 w-7 animate-spin text-brand-cornflower' /></CardContent></Card>}
  </div>
}
