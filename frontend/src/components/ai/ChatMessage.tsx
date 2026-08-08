'use client'

import { cn } from '@/lib/utils'
import { Icons } from '@/components/ui/icons'
import { Avatar } from '@/components/ui/avatar'
import type { ChatMessage as ChatMessageType } from '@/context/AIContext'
import { MarkdownContent } from './MarkdownContent'
import { ToolActivityCards } from './ToolActivityCards'

interface ChatMessageProps {
  message: ChatMessageType
  userName?: string
  userImage?: string | null
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

export function ChatMessage({ message, userName, userImage }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const isLoading = message.isLoading

  return <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
    <div className='flex-shrink-0'>
      {isUser ? <Avatar src={userImage} fallback={userName || 'U'} size='sm' /> :
        <div className='flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-navy to-brand-purple shadow-soft'>
          <Icons.sparkles className='h-4 w-4 text-white' strokeWidth={1.5} />
        </div>}
    </div>
    <div className={cn('flex max-w-[85%] flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
      <div className={cn(
        'rounded-2xl px-4 py-3 transition-all duration-200',
        isUser ? 'rounded-br-md bg-brand-navy text-white' : 'rounded-bl-md border border-border/50 bg-white/90 text-foreground shadow-soft',
        isLoading && 'animate-pulse'
      )}>
        {isLoading ? <div className='flex items-center gap-2 py-1'>
          <div className='flex gap-1'>
            <span className='h-2 w-2 animate-bounce rounded-full bg-brand-muted/60' style={{ animationDelay: '0ms' }} />
            <span className='h-2 w-2 animate-bounce rounded-full bg-brand-muted/60' style={{ animationDelay: '150ms' }} />
            <span className='h-2 w-2 animate-bounce rounded-full bg-brand-muted/60' style={{ animationDelay: '300ms' }} />
          </div>
          <span className='text-sm text-brand-muted'>Thinking...</span>
        </div> : isUser ?
          <p className='whitespace-pre-wrap text-sm leading-relaxed'>{message.content}</p> :
          <MarkdownContent content={message.content} />}
      </div>
      <span className={cn('text-[10px] text-muted-foreground/60', isUser ? 'pr-1' : 'pl-1')}>{formatTime(message.timestamp)}</span>
      {!isUser && <ToolActivityCards calls={message.toolCalls} />}
    </div>
  </div>
}
