'use client'

import { Icons } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

export type ToolActivity = {
  id?: string
  name?: string
  args?: Record<string, unknown>
  result?: unknown
}

type CardInfo = {
  title: string
  detail: string
  tone: 'success' | 'info' | 'warning' | 'error'
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function describe(call: ToolActivity): CardInfo {
  const args = record(call.args)
  const result = record(call.result)
  const error = typeof result.error === 'string' ? result.error : ''
  if (error) return { title: 'Action could not be completed', detail: error, tone: 'error' }

  switch (call.name) {
    case 'list_policies': {
      const total = count(result.policies)
      return { title: 'Policies checked', detail: `${total} existing ${total === 1 ? 'policy' : 'policies'} reviewed`, tone: 'success' }
    }
    case 'get_recent_runs': {
      const total = count(result.runs)
      return { title: 'Recent runs reviewed', detail: `${total} persisted ${total === 1 ? 'run' : 'runs'} checked`, tone: 'success' }
    }
    case 'get_run': {
      const run = record(result.run)
      return result.found
        ? { title: `Run #${String(run.id || args.run_id || '')} retrieved`, detail: `Status: ${String(run.status || 'recorded')}`, tone: 'success' }
        : { title: `Run #${String(args.run_id || '')} not found`, detail: 'No matching persisted run was available', tone: 'warning' }
    }
    case 'create_policy': {
      const policy = record(result.policy)
      return result.created
        ? { title: 'Policy created', detail: `${String(policy.name || args.name || 'New policy')} is ${policy.enabled === false ? 'disabled' : 'active'}`, tone: 'success' }
        : { title: 'Policy awaiting action', detail: 'The policy was not created', tone: 'warning' }
    }
    case 'trigger_operator':
      return result.triggered
        ? { title: `${String(args.operator_name || 'Operator')} triggered`, detail: `Source run #${String(result.source_run_id || args.run_id || '')} · workflow run ${String(result.workflow_run_id || 'started')}`, tone: 'success' }
        : { title: 'Operator was not triggered', detail: 'No workflow execution was started', tone: 'warning' }
    default:
      return { title: 'Assistant activity completed', detail: String(call.name || 'Database tool'), tone: 'info' }
  }
}

const toneStyles = {
  success: 'border-emerald-200 bg-emerald-50/80 text-emerald-900',
  info: 'border-blue-200 bg-blue-50/80 text-blue-900',
  warning: 'border-amber-200 bg-amber-50/80 text-amber-900',
  error: 'border-red-200 bg-red-50/80 text-red-900',
}

export function ToolActivityCards({ calls }: { calls?: ToolActivity[] }) {
  if (!calls?.length) return null
  return <div className='mt-3 space-y-2'>
    {calls.map((call, index) => {
      const info = describe(call)
      const StatusIcon = info.tone === 'success' ? Icons.checkCircle
        : info.tone === 'error' ? Icons.alertCircle
        : info.tone === 'warning' ? Icons.alertTriangle : Icons.activity
      return <div key={call.id || `${call.name}-${index}`} className={cn('rounded-xl border p-3', toneStyles[info.tone])}>
        <div className='flex items-start gap-2.5'>
          <StatusIcon className='mt-0.5 h-4 w-4 shrink-0' />
          <div className='min-w-0 flex-1'>
            <p className='text-xs font-semibold'>{info.title}</p>
            <p className='mt-0.5 break-words text-[11px] opacity-75'>{info.detail}</p>
            <details className='mt-2'>
              <summary className='cursor-pointer select-none text-[10px] font-medium opacity-60 hover:opacity-100'>Technical details</summary>
              <pre className='mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/5 p-2 text-[10px] leading-4'>{JSON.stringify({ tool: call.name, arguments: call.args || {}, result: call.result ?? null }, null, 2)}</pre>
            </details>
          </div>
        </div>
      </div>
    })}
  </div>
}
