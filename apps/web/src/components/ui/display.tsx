import { AlertTriangle, Loader2 } from 'lucide-react';
import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-surface', className)} {...props} />;
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
      <Spinner />
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Une erreur est survenue';
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger"
    >
      <AlertTriangle className="size-4 shrink-0" />
      {message}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className={cn('w-full text-left text-sm', className)} {...props} />
    </div>
  );
}

export const Th = ({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn(
      'whitespace-nowrap border-b border-border bg-subtle px-3 py-2 font-medium',
      className,
    )}
    {...props}
  />
);

export const Td = ({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('border-b border-border px-3 py-2 align-top', className)} {...props} />
);
