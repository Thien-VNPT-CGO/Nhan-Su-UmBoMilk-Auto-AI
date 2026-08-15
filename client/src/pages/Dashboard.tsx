import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, BrainCircuit, Hourglass, CheckCircle2, XCircle, GraduationCap,
  Trophy, AlertTriangle, RefreshCw, CalendarClock,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { api } from '../api/client';
import { StatCard, Skeleton } from '../components/ui';

interface Overview {
  today: number;
  aiScoring: number;
  pendingDecision: number;
  passToday: number;
  failToday: number;
  training: number;
  doneTraining: number;
  needReview: number;
  funnel: { stage: string; count: number }[];
  candidate7d: { date: string; count: number }[];
  trainingByBranch: { branch: string; count: number }[];
}

const PIE_COLORS = ['#ec4899', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6'];

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ overview: Overview }>('/dashboard')
      .then((d) => setData(d.overview))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  const funnelData = data.funnel.length ? data.funnel : [{ stage: 'Chưa có dữ liệu', count: 0 }];
  const doneRate = data.training + data.doneTraining > 0
    ? Math.round((data.doneTraining / (data.training + data.doneTraining)) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">Tổng quan</h1>
          <p className="text-sm text-slate-500">Trạng thái tuyển dụng & đào tạo hôm nay</p>
        </div>
        <button className="btn-secondary" onClick={() => window.location.reload()}>
          <RefreshCw size={15} /> Làm mới
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Hồ sơ hôm nay" value={data.today} icon={<FileText size={20} />} accent="brand" onClick={() => navigate('/candidates')} />
        <StatCard label="AI đang chấm" value={data.aiScoring} icon={<BrainCircuit size={20} />} accent="sky" onClick={() => navigate('/scoring')} />
        <StatCard label="Chờ duyệt" value={data.pendingDecision} icon={<Hourglass size={20} />} accent="amber" onClick={() => navigate('/scoring')} />
        <StatCard label="Đạt hôm nay" value={data.passToday} icon={<CheckCircle2 size={20} />} accent="emerald" onClick={() => navigate('/candidates?status=PASS')} />
        <StatCard label="Loại hôm nay" value={data.failToday} icon={<XCircle size={20} />} accent="rose" onClick={() => navigate('/candidates?status=FAIL')} />
        <StatCard label="Đang đào tạo" value={data.training} icon={<GraduationCap size={20} />} accent="indigo" onClick={() => navigate('/training')} />
        <StatCard label="Hoàn thành đào tạo" value={data.doneTraining} icon={<Trophy size={20} />} accent="emerald" onClick={() => navigate('/training')} />
        <StatCard label="Cần xử lý" value={data.needReview + data.pendingDecision} icon={<AlertTriangle size={20} />} accent="rose" onClick={() => navigate('/candidates?status=REVIEW')} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card p-5">
          <h3 className="font-bold text-slate-800 mb-4">Kênh tuyển dụng</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={funnelData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="stage" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Ứng viên" fill="#ec4899" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h3 className="font-bold text-slate-800 mb-4">Ứng viên 7 ngày</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.candidate7d} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="count" name="Hồ sơ" stroke="#db2777" strokeWidth={2.5} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h3 className="font-bold text-slate-800 mb-4">Đào tạo theo chi nhánh</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={data.trainingByBranch.length ? data.trainingByBranch : [{ branch: 'Chưa có', count: 1 }]}
                dataKey="count" nameKey="branch" cx="50%" cy="50%" outerRadius={85} label>
                {data.trainingByBranch.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5 flex flex-col">
          <h3 className="font-bold text-slate-800 mb-4">Tỉ lệ hoàn thành đào tạo</h3>
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="relative w-40 h-40">
              <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                <circle cx="60" cy="60" r="50" fill="none" stroke="#f1f5f9" strokeWidth="14" />
                <circle
                  cx="60" cy="60" r="50" fill="none" stroke="#10b981" strokeWidth="14"
                  strokeLinecap="round" strokeDasharray={`${doneRate * 3.14} 314`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-extrabold text-slate-800">{doneRate}%</span>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              {data.doneTraining} hoàn thành / {data.training + data.doneTraining} đang & hoàn thành
            </p>
            <button className="btn-secondary mt-4" onClick={() => navigate('/shifts')}>
              <CalendarClock size={15} /> Xem lịch làm việc
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}