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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl animate-[fadeInUp_.2s_ease]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">{footer}</div>}
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
        <AlertTriangle className="text-amber-500 mt-0.5" size={20} />
        <p className="text-sm text-slate-600">{message}</p>
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
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          'absolute top-0 right-0 h-full w-full bg-white shadow-2xl flex flex-col animate-[slideIn_.25s_ease]',
          width,
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 shrink-0">
          <h3 className="text-base font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
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
    brand: 'bg-brand-50 text-brand-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600',
    sky: 'bg-sky-50 text-sky-600',
    indigo: 'bg-indigo-50 text-indigo-600',
  };
  return (
    <button
      onClick={onClick}
      className="card p-4 text-left hover:shadow-md transition-shadow flex items-center gap-3.5"
    >
      <div className={cn('rounded-xl p-2.5', accents[accent])}>{icon}</div>
      <div>
        <div className="text-2xl font-extrabold text-slate-800 leading-none">{value}</div>
        <div className="text-xs font-medium text-slate-500 mt-1">{label}</div>
      </div>
    </button>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <Inbox size={40} strokeWidth={1.5} />
      <p className="mt-3 text-sm font-semibold text-slate-500">{title}</p>
      {hint && <p className="text-xs mt-1">{hint}</p>}
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
    <div className="flex gap-1 border-b border-slate-100 overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            'px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors',
            active === t.key
              ? 'text-brand-600 border-brand-500'
              : 'text-slate-500 border-transparent hover:text-slate-700',
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