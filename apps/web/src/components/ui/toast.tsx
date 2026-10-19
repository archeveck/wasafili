import { CheckCircle2, X, XCircle } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { cn } from '@/lib/utils';

interface Toast {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

const ToastContext = createContext<(kind: Toast['kind'], message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, kind, message }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'flex animate-overlay-in items-start gap-2.5 rounded-lg border border-border border-l-4 bg-surface p-3 text-sm text-foreground shadow-lg',
              toast.kind === 'error' ? 'border-l-danger' : 'border-l-success',
            )}
          >
            {toast.kind === 'error' ? (
              <XCircle className="mt-px size-4 shrink-0 text-danger" />
            ) : (
              <CheckCircle2 className="mt-px size-4 shrink-0 text-success" />
            )}
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              className="rounded p-0.5 text-muted transition-colors hover:bg-subtle hover:text-foreground"
              aria-label="Fermer"
              onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Notifications : `toast.success('…')`, `toast.error(erreur)`. */
export function useToast() {
  const notify = useContext(ToastContext);
  return {
    success: (message: string) => notify('success', message),
    error: (error: unknown) =>
      notify('error', error instanceof Error ? error.message : 'Une erreur est survenue'),
  };
}
