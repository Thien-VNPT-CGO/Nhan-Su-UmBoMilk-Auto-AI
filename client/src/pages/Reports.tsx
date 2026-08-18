import { useEffect, useState } from 'react';
import {
  Users, BrainCircuit, ClipboardCheck, MessageCircle, Download, GraduationCap, RefreshCw, Milk, FileCheck2,
} from 'lucide-react';
import { api } from '../api/client';
import { useI18n } from '../utils/i18n';
import { StatCard, Skeleton } from '../components/ui';
import { useAuth } from '../stores/auth';

interface MonthlyReport {
  month: string;
  candidates: {
    totalNew: number;
    scored: number;
    pendingDecision: number;
    pass: number;
    fail: number;
    review: number;
    byBranch: { branch: string; count: number }[];
  };
  training: {
    inTraining: number;
    completed: number;
    notEnoughDays: number;
    loai: number;
    employees: number;
    startedThisMonth: number;
  };
  attendance: {
    total: number;
    valid: number;
    absent: number;
    byShift: { shift: string; count: number }[];
    byMethod: { method: string; count: number }[];
  };
  zalo: { sent: number; received: number; failed: number };
}

export default function Reports() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    setLoading(true);
    api
      .get<MonthlyReport>(`/reports/monthly?month=${month}`)
      .then(setReport)
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, [month]);

  const exportCsv = () => {
    const url = `/api/reports/export?month=${month}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `bao-cao-${month}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800 dark:text-slate-100">{t('reports.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('reports.month')} {month}
            {!isAdmin && <span className="ml-2 text-brand-600 font-semibold">{user?.branchScope?.join(', ') ?? ''}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            className="input w-44"
            value={month}
            max={`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`}
            onChange={(e) => setMonth(e.target.value)}
          />
          <button className="btn-primary" onClick={exportCsv}>
            <Download size={15} /> {t('common.export')}
          </button>
        </div>
      </div>

      {loading && !report ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : report ? (
        <>
          {/* Tuyển dụng */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <Users size={15} className="text-brand-500" /> {t('reports.candidates')}
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label={t('reports.new')} value={report.candidates.totalNew} icon={<Milk size={18} />} accent="brand" />
              <StatCard label={t('reports.scored')} value={report.candidates.scored} icon={<BrainCircuit size={18} />} accent="indigo" />
              <StatCard label={t('reports.pendingDecision')} value={report.candidates.pendingDecision} icon={<FileCheck2 size={18} />} accent="amber" />
              <StatCard label={t('reports.pass') + ' / ' + t('reports.fail') + ' / ' + t('reports.review')} value={`${report.candidates.pass} / ${report.candidates.fail} / ${report.candidates.review}`} icon={<Users size={18} />} accent="emerald" />
            </div>
            {report.candidates.byBranch.length > 0 && (
              <div className="card p-4">
                <div className="text-xs font-bold uppercase text-slate-500 mb-3 dark:text-slate-400">{t('reports.byBranch')}</div>
                <div className="space-y-2">
                  {report.candidates.byBranch.map((b) => {
                    const max = report.candidates.byBranch[0]?.count ?? 1;
                    return (
                      <div key={b.branch} className="flex items-center gap-3">
                        <span className="w-40 text-sm text-slate-600 truncate dark:text-slate-300">{b.branch || '—'}</span>
                        <div className="flex-1 h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${(b.count / max) * 100}%` }} />
                        </div>
                        <span className="text-sm font-bold text-slate-700 w-8 text-right dark:text-slate-200">{b.count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Đào tạo */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <GraduationCap size={15} className="text-brand-500" /> {t('reports.training')}
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
              <StatCard label={t('reports.inTraining')} value={report.training.inTraining} icon={<GraduationCap size={18} />} accent="sky" />
              <StatCard label={t('reports.completed')} value={report.training.completed} icon={<GraduationCap size={18} />} accent="emerald" />
              <StatCard label={t('reports.notEnoughDays')} value={report.training.notEnoughDays} icon={<GraduationCap size={18} />} accent="amber" />
              <StatCard label={t('reports.loai')} value={report.training.loai} icon={<GraduationCap size={18} />} accent="rose" />
              <StatCard label={t('reports.employees')} value={report.training.employees} icon={<Milk size={18} />} accent="brand" />
              <StatCard label={t('reports.started')} value={report.training.startedThisMonth} icon={<RefreshCw size={18} />} accent="indigo" />
            </div>
          </section>

          {/* Chấm công */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <ClipboardCheck size={15} className="text-brand-500" /> {t('reports.attendance')}
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label={t('reports.totalChecks')} value={report.attendance.total} icon={<ClipboardCheck size={18} />} accent="brand" />
              <StatCard label={t('reports.valid')} value={report.attendance.valid} icon={<ClipboardCheck size={18} />} accent="emerald" />
              <StatCard label={t('reports.absent')} value={report.attendance.absent} icon={<ClipboardCheck size={18} />} accent="rose" />
              <div className="card p-4">
                <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-2">{t('reports.byShift')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {report.attendance.byShift.map((s) => (
                    <span key={s.shift} className="rounded-full bg-slate-100 text-slate-700 px-2.5 py-1 text-[11px] font-bold dark:bg-slate-800 dark:text-slate-300">
                      {s.shift}: {s.count}
                    </span>
                  ))}
                  {report.attendance.byShift.length === 0 && <span className="text-xs text-slate-400">{t('common.none')}</span>}
                </div>
              </div>
              <div className="card p-4">
                <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-2">{t('reports.byMethod')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {report.attendance.byMethod.map((s) => (
                    <span key={s.method} className="rounded-full bg-slate-100 text-slate-700 px-2.5 py-1 text-[11px] font-bold dark:bg-slate-800 dark:text-slate-300">
                      {s.method}: {s.count}
                    </span>
                  ))}
                  {report.attendance.byMethod.length === 0 && <span className="text-xs text-slate-400">{t('common.none')}</span>}
                </div>
              </div>
            </div>
          </section>

          {/* Zalo */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <MessageCircle size={15} className="text-brand-500" /> {t('reports.zalo')}
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <StatCard label={t('reports.sent')} value={report.zalo.sent} icon={<MessageCircle size={18} />} accent="brand" />
              <StatCard label={t('reports.received')} value={report.zalo.received} icon={<MessageCircle size={18} />} accent="emerald" />
              <StatCard label={t('reports.failed')} value={report.zalo.failed} icon={<MessageCircle size={18} />} accent="rose" />
            </div>
          </section>
        </>
      ) : (
        <div className="card p-10 text-center text-sm text-slate-400">{t('common.loading')}</div>
      )}
    </div>
  );
}