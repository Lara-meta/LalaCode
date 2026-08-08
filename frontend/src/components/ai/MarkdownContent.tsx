'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

export function MarkdownContent({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn('min-w-0 text-sm leading-6 text-foreground', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className='mb-2 mt-4 text-lg font-bold first:mt-0'>{children}</h1>,
          h2: ({ children }) => <h2 className='mb-2 mt-4 text-base font-bold first:mt-0'>{children}</h2>,
          h3: ({ children }) => <h3 className='mb-1.5 mt-3 font-semibold first:mt-0'>{children}</h3>,
          p: ({ children }) => <p className='mb-3 last:mb-0'>{children}</p>,
          ul: ({ children }) => <ul className='mb-3 ml-5 list-disc space-y-1 marker:text-brand-cornflower last:mb-0'>{children}</ul>,
          ol: ({ children }) => <ol className='mb-3 ml-5 list-decimal space-y-1 marker:font-semibold marker:text-brand-cornflower last:mb-0'>{children}</ol>,
          li: ({ children }) => <li className='pl-1'>{children}</li>,
          blockquote: ({ children }) => <blockquote className='my-3 border-l-4 border-brand-cornflower/50 bg-brand-cornflower/5 py-2 pl-4 pr-3 text-muted-foreground'>{children}</blockquote>,
          a: ({ href, children }) => <a href={href} target='_blank' rel='noreferrer noopener' className='font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900'>{children}</a>,
          code: ({ className: codeClassName, children }) => codeClassName ? (
            <code className={cn('font-mono text-xs', codeClassName)}>{children}</code>
          ) : (
            <code className='rounded bg-brand-navy/5 px-1.5 py-0.5 font-mono text-xs text-brand-navy'>{children}</code>
          ),
          pre: ({ children }) => <pre className='my-3 max-w-full overflow-x-auto rounded-xl bg-brand-navy p-4 text-slate-100 shadow-inner'>{children}</pre>,
          table: ({ children }) => <div className='my-3 overflow-x-auto rounded-xl border border-border'><table className='w-full border-collapse text-left text-xs'>{children}</table></div>,
          thead: ({ children }) => <thead className='bg-muted/70'>{children}</thead>,
          th: ({ children }) => <th className='border-b border-border px-3 py-2 font-semibold text-brand-navy'>{children}</th>,
          td: ({ children }) => <td className='border-b border-border/60 px-3 py-2 align-top last:border-r-0'>{children}</td>,
          hr: () => <hr className='my-4 border-border' />,
          strong: ({ children }) => <strong className='font-semibold text-brand-navy'>{children}</strong>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
