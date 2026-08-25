import { ReactNode } from 'react';
import { X, AlertTriangle, Loader2, Inbox } from 'lucide-react';
import { cn } from '../utils/format';

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold', className)}>
      {children}
    </span>
  );
}

export function Spinner({ className, size = 18 }: { className?: string; size?: number }) {
  return <Loader2 className={cn('animate-spin', className)} size={size} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-slate-200/70', className)} />;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className={cn('relative w-full my-auto rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl animate-[fadeInUp_.2s_ease] overflow-hidden max-h-[92vh] flex flex-col', width)}>
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 px-4 sm:px-6 py-4 shrink-0 bg-slate-50/50 dark:bg-slate-900/50">
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">{title}</h3>
          <button onClick={onClose} className="rounded-xl p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-4 sm:p-6 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800/80 px-4 sm:px-6 py-3.5 shrink-0 bg-slate-50/50 dark:bg-slate-900/50">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Xác nhận',
  danger = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Hủy</button>
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="text-amber-500 mt-0.5 shrink-0" size={20} />
        <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
      </div>
    </Modal>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  width = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          'absolute top-0 right-0 h-full w-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col animate-[slideIn_.25s_ease]',
          width,
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 sm:px-6 py-4 shrink-0">
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
      </div>
      <style>{`@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon,
  accent = 'brand',
  onClick,
}: {
  label: string;
  value: string | number;
  icon: ReactNode;
  accent?: 'brand' | 'emerald' | 'amber' | 'rose' | 'sky' | 'indigo';
  onClick?: () => void;
}) {
  const accents: Record<string, string> = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/20 dark:text-brand-300',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300',
    sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300',
    indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300',
  };
  return (
    <button
      onClick={onClick}
      className="card p-3.5 sm:p-4 text-left hover:shadow-md transition-shadow flex items-center gap-3.5"
    >
      <div className={cn('rounded-xl p-2.5 shrink-0', accents[accent])}>{icon}</div>
      <div className="min-w-0">
        <div className="text-xl sm:text-2xl font-extrabold text-slate-800 dark:text-slate-100 leading-none truncate">{value}</div>
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1 truncate">{label}</div>
      </div>
    </button>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 sm:py-16 text-slate-400">
      <Inbox size={36} strokeWidth={1.5} />
      <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">{title}</p>
      {hint && <p className="text-xs mt-1 text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-slate-100 dark:border-slate-800 overflow-x-auto whitespace-nowrap scrollbar-none">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            'px-3.5 py-2.5 text-xs sm:text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition-colors cursor-pointer shrink-0',
            active === t.key
              ? 'text-brand-600 border-brand-500 dark:text-brand-400 dark:border-brand-400 font-extrabold'
              : 'text-slate-500 border-transparent hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded-lg bg-slate-800 px-2 py-1 text-[11px] text-white opacity-0 group-hover:opacity-100 transition-opacity z-10">
        {text}
      </span>
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}