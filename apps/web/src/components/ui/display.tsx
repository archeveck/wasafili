import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-surface shadow-xs', className)}
      {...props}
    />
  );
}

export function Badge({
  className,
  color,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { color?: string | undefined }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        !color && 'border-border bg-subtle text-foreground',
        className,
      )}
      style={
        color ? { backgroundColor: `${color}1a`, borderColor: `${color}66`, color } : undefined
      }
      {...props}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2 className={cn('size-5 animate-spin text-muted', className)} aria-label="Chargement" />
  );
}

export function Loading() {
  return (
    <div className="flex justify-center py-16">
      <Spinner className="size-6 text-accent" />
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Une erreur est survenue';
  return (
    <div
      role="alert"
      className="flex items-center gap-2.5 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
    >
      <AlertTriangle className="size-4 shrink-0" />
      {message}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-foreground/15 bg-surface/60 px-6 py-12 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-subtle text-muted">
        <Inbox className="size-5" aria-hidden />
      </span>
      <p className="font-medium text-foreground">{title}</p>
      {children && <div className="mt-1.5 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-xs">
      <table
        className={cn(
          'w-full text-left text-sm [&_tbody_tr:last-child>td]:border-b-0 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-subtle/60',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export const Th = ({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn(
      'whitespace-nowrap border-b border-border bg-subtle/70 px-3 py-2.5 text-xs font-semibold text-muted',
      className,
    )}
    {...props}
  />
);

export const Td = ({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('border-b border-border px-3 py-2.5 align-top', className)} {...props} />
);
