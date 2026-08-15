import { createContext, useCallback, useContext, useState, ReactNode } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { cn } from '../utils/format';

interface Toast {
  id: number;
  type: 'success' | 'error';
  message: string;
}

const ToastContext = createContext<{ toast: (type: 'success' | 'error', message: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((type: 'success' | 'error', message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] space-y-2 w-80 max-w-[90vw]">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'animate-[fadeInUp_.25s_ease] flex items-start gap-2.5 rounded-xl p-3.5 text-sm shadow-lg border',
              t.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800',
            )}
          >
            {t.type === 'success' ? (
              <CheckCircle2 className="w-4.5 h-4.5 mt-0.5 shrink-0" size={18} />
            ) : (
              <AlertCircle className="mt-0.5 shrink-0" size={18} />
            )}
            <span className="flex-1 break-words">{t.message}</span>
            <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="shrink-0 opacity-50 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <style>{`@keyframes fadeInUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}