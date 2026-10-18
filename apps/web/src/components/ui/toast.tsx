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
        className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'flex items-start gap-2 rounded-md border bg-surface p-3 text-sm shadow-lg',
              toast.kind === 'error' ? 'border-danger/40' : 'border-success/40',
            )}
          >
            {toast.kind === 'error' ? (
              <XCircle className="size-4 shrink-0 text-danger" />
            ) : (
              <CheckCircle2 className="size-4 shrink-0 text-success" />
            )}
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
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
