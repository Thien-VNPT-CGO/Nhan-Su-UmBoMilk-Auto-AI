import { useEffect, useState, useCallback } from 'react';
import {
  FileSpreadsheet, BrainCircuit, MessageCircle, Scale, Clock, Users as UsersIcon,
  Save, AlertTriangle, ShieldCheck, RefreshCw, RotateCcw, Settings2, Trash2,
  MapPin, Bell, DatabaseBackup, KeyRound, Plus, Video, CalendarDays, Link2, Trash2 as TrashIcon,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Badge, Spinner, Modal, ConfirmDialog } from '../components/ui';
import { useToast } from '../stores/Toast';
import { useAuth } from '../stores/auth';
import { useI18n } from '../utils/i18n';
import { cn } from '../utils/format';

interface BranchConfig {
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}

interface SettingsData {
  settings: {
    scoring: {
      passThreshold: number;
      rules: {
        hoTen: { enabled: boolean; score: number };
        namSinh: { enabled: boolean; score: number; tiers: { min: number | null; max: number | null; score: number }[] };
        queQuan: { enabled: boolean; score: number; allowed: string[] };
        sdt: { enabled: boolean; score: number };
        trinhDo: { enabled: boolean; scores: { SinhVienDaiHoc_CaoDang: number; NghiHoc: number } };
        kinhNghiem: { enabled: boolean; scores: { NO_EXPERIENCE: number; OTHER_EXPERIENCE: number; FNB_EXPERIENCE: number } };
        xuLy: { enabled: boolean; score: number };
        linkFb: { enabled: boolean; score: number };
        kenhBietTin: { enabled: boolean; score: number };
      };
    };
    attendance: {
      shifts: {
        SANG: { start: string; end: string; windowMinutesBefore: number; windowMinutesAfter: number };
        CHIEU: { start: string; end: string; windowMinutesBefore: number; windowMinutesAfter: number };
        TOI: { start: string; end: string; windowMinutesBefore: number; windowMinutesAfter: number };
      };
      trainingDaysRequired: number;
      trainingDeadlineDays: number;
      geofenceEnabled: boolean;
    };
    branches: BranchConfig[];
    notifications: {
      telegramBotToken: string;
      telegramChatId: string;
      slackWebhookUrl: string;
      queueAlertMinutes: number;
    };
    ai: { provider: string; baseUrl: string; apiKey: string; model: string; temperature: number };
    googleSheet: {
      spreadsheetId: string;
      serviceAccountEmail: string;
      privateKey: string;
      formResponsesId: string;
      sheets: { locHoSo: string; diemUv: string; hoSoNv: string };
    };
    zalo: { oaId: string; accessToken: string; refreshToken: string; autoReply: boolean };
    interview: {
      durationMinutes: number;
      remindHoursBefore: number;
      autoRemind: boolean;
      branchMeetLinks: Record<string, string>;
    };
    googleCalendar: {
      enabled: boolean;
      clientId: string;
      clientSecret: string;
      refreshToken: string;
      calendarId: string;
    };
  };
  googleSheetConfigured: boolean;
  demoMode: boolean;
  users: { id: string; username: string; fullName: string; role: string; active: boolean; twoFactorEnabled?: boolean; branchScope?: string[] | null }[];
  conflicts: {
    id: string; entityId: string; field: string; webValue: string; sheetValue: string;
    webVersion: number; sheetVersion: number | null; createdAt: string;
  }[];
}

interface BackupRow {
  id: string;
  kind: string;
  status: string;
  sizeBytes: number;
  driveId?: string | null;
  createdAt: string;
  summary?: Record<string, number>;
}

export default function Settings() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { t } = useI18n();
  const [data, setData] = useState<SettingsData | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('sheet');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetting, setResetting] = useState(false);

  // Backup
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null);
  const [restoring, setRestoring] = useState(false);

  // 2FA
  const [twoFactorSetup, setTwoFactorSetup] = useState<{ secret?: string; otpauthUrl?: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);

  // Đổi mật khẩu
  const [pwdForm, setPwdForm] = useState({ oldPassword: '', newPassword: '', totpCode: '' });
  const [pwdBusy, setPwdBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<SettingsData>('/settings');
      setData(d);
    } catch {
      toast('error', 'Không tải được cài đặt.');
    }
  }, [toast]);

  const loadBackups = useCallback(async () => {
    try {
      const d = await api.get<{ rows: BackupRow[] }>('/backup');
      setBackups(d.rows);
    } catch {
      /* tab backup chỉ hiển thị khi có lỗi mạng */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadBackups();
  }, [load, loadBackups]);

  const [branchMeetRows, setBranchMeetRows] = useState<{ name: string; link: string }[]>([]);

  useEffect(() => {
    if (data) {
      setBranchMeetRows(Object.entries(data.settings.interview?.branchMeetLinks ?? {}).map(([name, link]) => ({ name, link })));
    }
  }, [data]);

  if (!data) {
    return <div className="flex justify-center py-20"><Spinner className="text-brand-500" size={28} /></div>;
  }

  const applyBranchMeetRows = (rows: { name: string; link: string }[]) => {
    setBranchMeetRows(rows);
    const links: Record<string, string> = {};
    rows.forEach((r) => {
      if (r.name.trim()) links[r.name.trim()] = r.link.trim();
    });
    patch(['interview', 'branchMeetLinks'], links);
  };

  const patch = (path: (string | number)[], value: unknown) => {
    setData((d) => {
      if (!d) return d;
      const clone = structuredClone(d);
      let cur: unknown = clone.settings;
      for (let i = 0; i < path.length - 1; i++) {
        cur = (cur as Record<string | number, unknown>)[path[i]];
      }
      (cur as Record<string | number, unknown>)[path[path.length - 1]] = value;
      return clone;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put<{ settings: unknown; provision?: { demo?: boolean; started?: boolean; created?: string[]; candidates?: number; error?: string } }>('/settings', data!.settings);
      if (r.provision) {
        if (r.provision.demo) {
          toast('success', 'Đã lưu. Google Sheet chưa được cấu hình — vẫn chạy DEMO MODE.');
        } else if (r.provision.started) {
          toast('success', 'Đã lưu. Đang tạo cấu trúc + đồng bộ dữ liệu trong nền (web không bị treo).');
        } else if (r.provision.error) {
          toast('error', `Đã lưu, nhưng lỗi liên kết: ${r.provision.error}`);
        } else {
          toast('success', `Đã tạo sheet: ${(r.provision.created ?? []).join(', ') || '(đã có sẵn)'} và đồng bộ ${r.provision.candidates} hồ sơ.`);
        }
      } else {
        toast('success', 'Đã lưu cài đặt.');
      }
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Lưu thất bại.');
    } finally {
      setSaving(false);
    }
  };

  const provision = async () => {
    try {
      const r = await api.post<{ demo: boolean; started?: boolean; created?: string[]; columnsAdded?: Record<string, string[]>; candidates?: number; enqueued?: number }>('/sync/provision');
      if (r.demo) {
        toast('success', `DEMO MODE: đã xếp hàng đồng bộ ${r.enqueued} hồ sơ (chưa có Google Sheet thật).`);
      } else if (r.started) {
        toast('success', 'Đã bắt đầu tạo cấu trúc + đồng bộ toàn bộ dữ liệu trong nền.');
      } else {
        toast('success', `Đã tạo sheet: ${(r.created ?? []).join(', ') || '(đã có sẵn)'}, thêm cột: ${Object.values(r.columnsAdded ?? {}).flat().length} cột, đồng bộ ${r.candidates} hồ sơ.`);
      }
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Tạo cấu trúc thất bại.');
    }
  };

  const resolveConflict = async (id: string, keep: 'WEB' | 'SHEET') => {
    try {
      await api.post(`/conflicts/${id}/resolve`, { keep });
      toast('success', keep === 'WEB' ? 'Đã giữ dữ liệu WEB.' : 'Đã giữ dữ liệu GOOGLE SHEET.');
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Thất bại.');
    }
  };

  const connectZalo = async () => {
    try {
      const r = await api.get<{ url: string; state: string }>('/zalo/oauth-url');
      window.location.href = r.url;
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Không tạo được link kết nối Zalo.');
    }
  };

  const resetZalo = async () => {
    if (!window.confirm('Reset dữ liệu setup Zalo (OA ID + token)?')) return;
    patch(['zalo', 'oaId'], '');
    patch(['zalo', 'accessToken'], '');
    patch(['zalo', 'refreshToken'], '');
    try {
      await api.post('/settings/zalo/disconnect', {});
      toast('success', 'Đã reset dữ liệu Zalo.');
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Reset dữ liệu Zalo thất bại.');
    }
  };

  const connectCalendar = async () => {
    try {
      const r = await api.get<{ url: string; state: string }>('/calendar/oauth-url');
      window.location.href = r.url;
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Không tạo được link kết nối Google Calendar.');
    }
  };

  const testCalendar = async () => {
    try {
      const r = await api.post<{ id: string; hangoutLink: string }>('/calendar/test', {});
      toast('success', `Kết nối OK! Sự kiện thử đã tạo: ${r.hangoutLink}`);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Kết nối thất bại.');
    }
  };

  const disconnectCalendar = async () => {
    if (!window.confirm('Ngắt kết nối Google Calendar? Sẽ không tự tạo link Meet mới cho tới khi kết nối lại.')) return;
    try {
      await api.post('/calendar/disconnect', {});
      toast('success', 'Đã ngắt kết nối Google Calendar.');
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Ngắt kết nối thất bại.');
    }
  };

  const updateUserScope = async (userId: string, branchScope: string[] | null) => {
    try {
      await api.post(`/settings/users/${userId}`, { branchScope });
      toast('success', 'Đã cập nhật phạm vi chi nhánh.');
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Cập nhật thất bại.');
    }
  };

  const createBackup = async () => {
    setSaving(true);
    try {
      await api.post('/backup', {});
      toast('success', 'Đã tạo bản sao lưu.');
      await loadBackups();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Sao lưu thất bại.');
    } finally {
      setSaving(false);
    }
  };

  const doRestore = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      const r = await api.post<{ restored: number }>(`/backup/${restoreTarget.id}/restore`, {});
      toast('success', `Đã khôi phục ${r.restored} bản ghi.`);
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Khôi phục thất bại.');
    } finally {
      setRestoring(false);
      setRestoreTarget(null);
    }
  };

  const downloadBackup = (b: BackupRow) => {
    const a = document.createElement('a');
    a.href = `/api/backup/${b.id}/download`;
    a.download = `umbo-milk-backup-${b.createdAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const startTwoFactorSetup = async () => {
    setTwoFactorBusy(true);
    try {
      const r = await api.post<{ enabled: boolean; secret?: string; otpauthUrl?: string }>('/auth/two-factor/setup', {});
      if (r.enabled) {
        toast('success', '2FA đã được bật.');
        void load();
      } else {
        setTwoFactorSetup({ secret: r.secret, otpauthUrl: r.otpauthUrl });
      }
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Không tạo được 2FA.');
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const confirmTwoFactor = async () => {
    setTwoFactorBusy(true);
    try {
      const r = await api.post<{ enabled: boolean }>('/auth/two-factor/setup', { code: totpCode });
      if (r.enabled) {
        toast('success', '2FA đã được bật.');
        setTwoFactorSetup(null);
        setTotpCode('');
        void load();
        window.location.reload();
      }
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Sai mã xác thực.');
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const disableTwoFactor = async () => {
    setTwoFactorBusy(true);
    try {
      const r = await api.post<{ disabled: boolean }>('/auth/two-factor/disable', { code: totpCode });
      if (r.disabled) {
        toast('success', '2FA đã được tắt.');
        setTotpCode('');
        void load();
        window.location.reload();
      }
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Sai mã xác thực.');
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const changePassword = async () => {
    if (pwdForm.newPassword.length < 6) {
      toast('error', 'Mật khẩu mới phải có ít nhất 6 ký tự.');
      return;
    }
    setPwdBusy(true);
    try {
      await api.post('/auth/change-password', pwdForm);
      toast('success', 'Đã đổi mật khẩu.');
      setPwdForm({ oldPassword: '', newPassword: '', totpCode: '' });
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Đổi mật khẩu thất bại.');
    } finally {
      setPwdBusy(false);
    }
  };

  const sendTestNotification = async () => {
    try {
      const r = await api.post<{ telegram?: boolean; slack?: boolean }>('/settings/notify-test', {});
      const parts: string[] = [];
      if (r.telegram) parts.push('Telegram');
      if (r.slack) parts.push('Slack');
      toast('success', parts.length ? `Đã gửi thử: ${parts.join(' + ')}.` : 'Chưa cấu hình Telegram/Slack — chỉ hiện trong bell.');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Gửi thử thất bại.');
    }
  };

  const s = data.settings;
  const isAdmin = user?.role === 'ADMIN';
  const TABS = [
    { key: 'sheet', label: 'Google Sheet', icon: FileSpreadsheet },
    { key: 'ai', label: 'AI', icon: BrainCircuit },
    { key: 'zalo', label: 'Zalo', icon: MessageCircle },
    { key: 'interview', label: 'Phỏng vấn & Meet', icon: Video },
    { key: 'scoring', label: 'Chấm điểm tuyển dụng', icon: Scale },
    { key: 'attendance', label: 'Chấm công', icon: Clock },
    { key: 'branches', label: 'Chi nhánh & Geofence', icon: MapPin },
    { key: 'notifications', label: 'Thông báo', icon: Bell },
    { key: 'security', label: 'Bảo mật', icon: KeyRound },
    { key: 'backup', label: 'Sao lưu', icon: DatabaseBackup },
    { key: 'conflicts', label: 'Xung đột', icon: AlertTriangle },
    { key: 'users', label: 'Tài khoản', icon: UsersIcon },
    ...(user?.role === 'ADMIN'
      ? [{ key: 'system', label: 'Hệ thống', icon: Settings2 }]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800 dark:text-slate-100">Cài đặt hệ thống</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Chỉ ADMIN mới có thể chỉnh sửa</p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'sheet' && (
            <button className="btn-secondary" onClick={provision}>
              <FileSpreadsheet size={15} /> Tạo cấu trúc & đồng bộ
            </button>
          )}
          {tab === 'backup' && (
            <button className="btn-secondary" onClick={createBackup} disabled={saving}>
              {saving && <Spinner size={14} />} <DatabaseBackup size={15} /> Sao lưu ngay
            </button>
          )}
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving && <Spinner size={14} />} <Save size={15} /> Lưu cài đặt
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[220px_1fr] gap-5">
        <div className="space-y-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors',
                tab === t.key ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800',
              )}
            >
              <t.icon size={16} />
              {t.label}
              {t.key === 'conflicts' && data.conflicts.length > 0 && (
                <Badge className="ml-auto bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300">{data.conflicts.length}</Badge>
              )}
            </button>
          ))}
        </div>

        <div className="card p-5">
          {tab === 'sheet' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={cn('rounded-xl p-2.5', data.googleSheetConfigured ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600')}>
                  <FileSpreadsheet size={20} />
                </div>
                <div>
                  <div className="font-bold text-slate-800 dark:text-slate-100">
                    {data.googleSheetConfigured ? 'Đã cấu hình Google Sheet' : 'Chưa cấu hình (DEMO MODE)'}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {data.demoMode
                      ? 'Hệ thống đang chạy DEMO MODE: dữ liệu vẫn được lưu đầy đủ trong DB, Sync Job vẫn được tạo và xử lý. Cấu hình Service Account để đồng bộ thật.'
                      : 'Service Account hoạt động. Mọi thao tác Web được đồng bộ 1:1 xuống Google Sheet.'}
                  </div>
                </div>
              </div>
              <div>
                <label className="label">Spreadsheet ID</label>
                <input className="input" value={s.googleSheet.spreadsheetId} onChange={(e) => patch(['googleSheet', 'spreadsheetId'], e.target.value)} placeholder="1Abc...XYZ" />
              </div>
              <div>
                <label className="label">Service Account Email</label>
                <input className="input" value={s.googleSheet.serviceAccountEmail} onChange={(e) => patch(['googleSheet', 'serviceAccountEmail'], e.target.value)} placeholder="umbomilk@...iam.gserviceaccount.com" />
              </div>
              <div>
                <label className="label">Private Key (-----BEGIN PRIVATE KEY-----...)</label>
                <textarea className="input min-h-[90px] font-mono text-[11px]" value={s.googleSheet.privateKey} onChange={(e) => patch(['googleSheet', 'privateKey'], e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----&#10;MIIEvQIBADANBgkqh...&#10;-----END PRIVATE KEY-----" />
              </div>
              <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/40 p-3.5">
                <div className="text-xs font-semibold text-brand-700 mb-1">
                  Tự động nhập ứng viên từ Google Form (không cần Apps Script)
                </div>
                <label className="label">Form Responses Sheet ID</label>
                <input className="input" value={s.googleSheet.formResponsesId} onChange={(e) => patch(['googleSheet', 'formResponsesId'], e.target.value)} placeholder="1Abc...XYZ" />
                <div className="text-[11px] text-slate-500 mt-2 space-y-1">
                  <div>1. Trong form: tab <b>Phản hồi</b> → <b>Liên kết với Sheets</b> (tạo spreadsheet phản hồi).</div>
                  <div>2. Mở spreadsheet đó → nút <b>Chia sẻ</b> → thêm <b>{data.googleSheetConfigured ? 'Service Account Email' : 'Service Account Email của bạn'}</b> (quyền xem).</div>
                  <div>3. Copy ID trong URL (<i>/spreadsheets/d/&lt;ID&gt;/edit</i>) dán vào ô trên.</div>
                  <div>4. Hệ thống tự kiểm tra mỗi phút + có nút nhập ngay bên dưới.</div>
                </div>
                <button
                  type="button"
                  className="btn-primary mt-3"
                  disabled={saving}
                  onClick={async () => {
                    try {
                      const r = await api.post<{ started: boolean; lastError: string | null; lastRunAt: string | null }>('/sync/form-import', {});
                      if (r.started) {
                        toast('success', 'Đã bắt đầu nhập dữ liệu form trong nền — hồ sơ mới sẽ hiện theo thời gian thực.');
                      } else if (r.lastError) toast('error', 'Lỗi: ' + r.lastError);
                      else toast('success', `Nhập xong: +${(r as unknown as { imported?: number }).imported ?? 0} mới${r.lastRunAt ? ' · lần chạy: ' + new Date(r.lastRunAt).toLocaleTimeString('vi-VN') : ''}`);
                    } catch (e) {
                      toast('error', e instanceof ApiError ? e.message : 'Nhập dữ liệu form thất bại.');
                    }
                  }}
                >
                  <RefreshCw size={14} /> Nhập dữ liệu form ngay
                </button>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                {(['locHoSo', 'diemUv', 'hoSoNv'] as const).map((k) => (
                  <div key={k}>
                    <label className="label">Sheet {k}</label>
                    <input className="input" value={s.googleSheet.sheets[k]} onChange={(e) => patch(['googleSheet', 'sheets', k], e.target.value)} />
                  </div>
                ))}
              </div>
              <div className="rounded-xl bg-emerald-50 p-3.5 text-xs text-emerald-700">
                Sau khi lưu cấu hình Google Sheet thật, hệ thống sẽ <b>tự động tạo các sheet
                (LOC_HO_SO_PV, DIEM_UV, HO_SO_NHAN_VIEN_UNG_TUYEN) + cột chuẩn</b> nếu chưa có,
                rồi đồng bộ toàn bộ dữ liệu hiện có xuống. Dữ liệu mới từ Web luôn được đồng bộ 1:1 theo thời gian thực.
              </div>
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                Cấu hình qua <b>server/.env</b>: GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY. Cài đặt trên Web ghi đè khi chạy.
                Apps Script webhook: POST <b>/api/webhooks/sheet</b> với header <b>x-webhook-secret</b>.
              </div>
            </div>
          )}

          {tab === 'ai' && (
            <div className="space-y-4">
              <div>
                <label className="label">Provider</label>
                <select className="input" value={s.ai.provider} onChange={(e) => patch(['ai', 'provider'], e.target.value)}>
                  <option value="mock">Mock (offline, không cần API key)</option>
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Gemini</option>
                  <option value="openai-compatible">OpenAI-compatible API</option>
                </select>
              </div>
              <div>
                <label className="label">Base URL</label>
                <input className="input" value={s.ai.baseUrl} onChange={(e) => patch(['ai', 'baseUrl'], e.target.value)} placeholder="https://api.openai.com/v1" />
              </div>
              <div>
                <label className="label">API Key</label>
                <input type="password" className="input" value={s.ai.apiKey} onChange={(e) => patch(['ai', 'apiKey'], e.target.value)} placeholder="sk-..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Model</label>
                  <input className="input" value={s.ai.model} onChange={(e) => patch(['ai', 'model'], e.target.value)} placeholder={s.ai.provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini'} />
                </div>
                <div>
                  <label className="label">Temperature</label>
                  <input type="number" step="0.1" min="0" max="2" className="input" value={s.ai.temperature}
                    onChange={(e) => patch(['ai', 'temperature'], Number(e.target.value))} />
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                AI trả Structured JSON cho: trình độ học vấn, kinh nghiệm (NO_EXPERIENCE / OTHER_EXPERIENCE / FNB_EXPERIENCE), xử lý tình huống, quê quán, SĐT, Facebook.
              </div>
            </div>
          )}

          {tab === 'zalo' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4 flex-wrap gap-3 dark:bg-slate-800/60">
                <div>
                  <div className="font-bold text-slate-800 text-sm dark:text-slate-100">Kết nối Zalo OA</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Bấm nút để mở trang duyệt quyền của Zalo — token sẽ được tự động lưu về hệ thống.</div>
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary" onClick={connectZalo}>
                    <MessageCircle size={15} /> Kết nối Zalo OA
                  </button>
                  <button className="btn-danger" onClick={resetZalo}>
                    Reset dữ liệu Zalo
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                <div>
                  <div className="font-semibold text-slate-800 text-sm dark:text-slate-100">AI tự trả lời tin nhắn Zalo</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Tự động trả lời ứng viên (trừ lệnh điểm danh GPS).</div>
                </div>
                <input type="checkbox" className="w-5 h-5 accent-brand-600" checked={s.zalo.autoReply}
                  onChange={(e) => patch(['zalo', 'autoReply'], e.target.checked)} />
              </div>
              <div>
                <label className="label">Zalo OA ID</label>
                <input className="input" value={s.zalo.oaId} onChange={(e) => patch(['zalo', 'oaId'], e.target.value)} />
              </div>
              <div>
                <label className="label">Access Token</label>
                <input type="password" className="input" value={s.zalo.accessToken} onChange={(e) => patch(['zalo', 'accessToken'], e.target.value)} />
              </div>
              <div>
                <label className="label">Refresh Token</label>
                <input type="password" className="input" value={s.zalo.refreshToken} onChange={(e) => patch(['zalo', 'refreshToken'], e.target.value)} />
              </div>
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                Webhook Zalo: POST <b>/api/zalo/webhook</b> (header x-webhook-secret). Khi ứng viên nhắn "ĐIỂM DANH" trong khung giờ ca, hệ thống tự điểm danh.
              </div>
            </div>
          )}

          {tab === 'interview' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4 flex-wrap gap-3 dark:bg-slate-800/60">
                <div className="flex items-center gap-3">
                  <div className={cn('rounded-xl p-2.5', s.googleCalendar.enabled && s.googleCalendar.refreshToken ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400')}>
                    <CalendarDays size={20} />
                  </div>
                  <div>
                    <div className="font-bold text-slate-800 text-sm dark:text-slate-100">
                      {s.googleCalendar.enabled && s.googleCalendar.refreshToken ? 'Đã kết nối Google Calendar' : 'Chưa kết nối Google Calendar'}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Khi chấm PASS: hệ thống tự tạo sự kiện + link Google Meet mới và gửi cho ứng viên (thay thế link chi nhánh).
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button className="btn-primary" onClick={connectCalendar}>
                    <Link2 size={15} /> Kết nối Google Calendar
                  </button>
                  {s.googleCalendar.refreshToken && (
                    <>
                      <button className="btn-secondary" onClick={testCalendar}>
                        <RefreshCw size={15} /> Kiểm tra (tạo sự kiện thử)
                      </button>
                      <button className="btn-danger" onClick={disconnectCalendar}>
                        Ngắt kết nối
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400 space-y-1">
                <div><b>Hướng dẫn kết nối (5 phút):</b></div>
                <div>1. Google Cloud Console → tạo project → bật API <b>Google Calendar API</b>.</div>
                <div>2. OAuth consent screen → thêm scope <b>calendar.events</b>, thêm email của bạn vào Test users.</div>
                <div>3. Credentials → OAuth Client ID (Web) → redirect URI: <b>{window.location.origin}/api/calendar/oauth-callback</b>.</div>
                <div>4. Điền Client ID / Client Secret bên dưới → bấm "Kết nối Google Calendar" → duyệt quyền 1 lần.</div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Google OAuth Client ID</label>
                  <input className="input" value={s.googleCalendar.clientId} onChange={(e) => patch(['googleCalendar', 'clientId'], e.target.value)} placeholder="xxx.apps.googleusercontent.com" />
                </div>
                <div>
                  <label className="label">Google OAuth Client Secret</label>
                  <input type="password" className="input" value={s.googleCalendar.clientSecret} onChange={(e) => patch(['googleCalendar', 'clientSecret'], e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Calendar ID (mặc định "primary" = lịch chính của tài khoản)</label>
                <input className="input" value={s.googleCalendar.calendarId} onChange={(e) => patch(['googleCalendar', 'calendarId'], e.target.value)} placeholder="primary" />
              </div>

              <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
                <div className="font-bold text-slate-800 text-sm mb-3 dark:text-slate-100">Link GG Meet mặc định theo chi nhánh</div>
                <div className="text-xs text-slate-500 mb-3 dark:text-slate-400">
                  Dùng khi chưa kết nối Calendar hoặc khi tạo link tự động thất bại. HR bấm Đạt chỉ cần chọn giờ — link chi nhánh tự kèm theo.
                </div>
                <div className="space-y-2">
                  {branchMeetRows.map((row, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        className="input !w-48"
                        value={row.name}
                        placeholder="Tên chi nhánh"
                        onChange={(e) => {
                          const rows = [...branchMeetRows];
                          rows[i] = { ...row, name: e.target.value };
                          applyBranchMeetRows(rows);
                        }}
                      />
                      <input
                        className="input flex-1"
                        value={row.link}
                        placeholder="https://meet.google.com/xxx-xxxx-xxx"
                        onChange={(e) => {
                          const rows = [...branchMeetRows];
                          rows[i] = { ...row, link: e.target.value };
                          applyBranchMeetRows(rows);
                        }}
                      />
                      <button className="btn-secondary !px-2.5 !py-1.5" onClick={() => applyBranchMeetRows(branchMeetRows.filter((_, j) => j !== i))}>
                        <TrashIcon size={14} />
                      </button>
                    </div>
                  ))}
                  {branchMeetRows.length === 0 && (
                    <p className="text-xs text-slate-400">Chưa có link nào. Thêm link mặc định cho từng chi nhánh.</p>
                  )}
                  <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => applyBranchMeetRows([...branchMeetRows, { name: '', link: '' }])}>
                    <Plus size={13} /> Thêm chi nhánh
                  </button>
                </div>
              </div>

              <div className="border-t border-slate-100 dark:border-slate-700 pt-4 space-y-4">
                <div className="font-bold text-slate-800 text-sm dark:text-slate-100">Nhắc phỏng vấn tự động</div>
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                  <div>
                    <div className="font-semibold text-slate-800 text-sm dark:text-slate-100">Tự nhắc ứng viên qua Zalo</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Gửi tin nhắc trước giờ phỏng vấn (1 lần/lịch hẹn).</div>
                  </div>
                  <input type="checkbox" className="w-5 h-5 accent-brand-600" checked={s.interview.autoRemind}
                    onChange={(e) => patch(['interview', 'autoRemind'], e.target.checked)} />
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Nhắc trước (giờ)</label>
                    <input type="number" min={1} max={72} className="input" value={s.interview.remindHoursBefore}
                      onChange={(e) => patch(['interview', 'remindHoursBefore'], Number(e.target.value) || 2)} />
                  </div>
                  <div>
                    <label className="label">Thời lượng buổi phỏng vấn (phút)</label>
                    <input type="number" min={5} max={180} className="input" value={s.interview.durationMinutes}
                      onChange={(e) => patch(['interview', 'durationMinutes'], Number(e.target.value) || 30)} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'scoring' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                <div>
                  <div className="font-bold text-slate-800 text-sm dark:text-slate-100">Ngưỡng PASS (TONG_DIEM ≥)</div>
                  <div className="text-xs text-slate-500">Xếp loại: 8–9 Đạt · 10–11 Giỏi · ≥12 Xuất Sắc · AI_RECOMMENDATION = PASS nếu đạt ngưỡng</div>
                </div>
                <input
                  type="number" min="0" max="12" className="input !w-20 text-center font-extrabold"
                  value={s.scoring.passThreshold}
                  onChange={(e) => patch(['scoring', 'passThreshold'], Number(e.target.value))}
                />
              </div>

              {([
                ['hoTen', 'Họ tên (có dữ liệu)', 'score'],
                ['queQuan', 'Quê quán (Miền Tây / TP.HCM)', 'score'],
                ['sdt', 'SĐT hợp lệ', 'score'],
                ['xuLy', 'Xử lý tình huống (có trả lời)', 'score'],
                ['linkFb', 'Facebook (CO_VE_CHINH_CHU)', 'score'],
              ] as const).map(([key, label, field]) => {
                const rule = s.scoring.rules[key];
                return (
                  <div key={key} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                    <div className="flex items-center gap-3">
                      <input type="checkbox" checked={rule.enabled} onChange={(e) => patch(['scoring', 'rules', key, 'enabled'], e.target.checked)} className="w-4 h-4 accent-brand-600" />
                      <div>
                        <div className="font-semibold text-slate-800 text-sm dark:text-slate-100">{label}</div>
                        <div className="text-xs text-slate-400">ENABLE / DISABLE</div>
                      </div>
                    </div>
                    <input
                      type="number" min="0" max="5" className="input !w-20 text-center font-extrabold"
                      value={(rule as unknown as Record<string, number>)[field]}
                      onChange={(e) => patch(['scoring', 'rules', key, field], Number(e.target.value))}
                    />
                  </div>
                );
              })}

              <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                <div className="flex items-center gap-3 mb-2">
                  <input type="checkbox" checked={s.scoring.rules.namSinh.enabled}
                    onChange={(e) => patch(['scoring', 'rules', 'namSinh', 'enabled'], e.target.checked)}
                    className="w-4 h-4 accent-brand-600" />
                  <div>
                    <div className="font-semibold text-slate-800 text-sm dark:text-slate-100">Năm sinh (theo giai đoạn)</div>
                    <div className="text-xs text-slate-400">Chấm theo năm sinh: min–max (bỏ trống = không giới hạn đầu đó)</div>
                  </div>
                </div>
                <div className="space-y-2">
                  {(s.scoring.rules.namSinh.tiers ?? []).map((t, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="w-16 shrink-0">Giai đoạn {i + 1}:</span>
                      <input type="number" className="input !w-20"
                        value={t.min ?? ''}
                        placeholder="min"
                        onChange={(e) => { const v = e.target.value; patch(['scoring', 'rules', 'namSinh', 'tiers', i, 'min'], v === '' ? null : Number(v)); }} />
                      <span>→</span>
                      <input type="number" className="input !w-20"
                        value={t.max ?? ''}
                        placeholder="max"
                        onChange={(e) => { const v = e.target.value; patch(['scoring', 'rules', 'namSinh', 'tiers', i, 'max'], v === '' ? null : Number(v)); }} />
                      <input type="number" min="0" max="5" className="input !w-16 text-center font-extrabold"
                        value={t.score}
                        onChange={(e) => patch(['scoring', 'rules', 'namSinh', 'tiers', i, 'score'], Number(e.target.value))} />
                      <span>điểm</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                <div className="flex items-center gap-3 mb-1">
                  <input type="checkbox" checked={s.scoring.rules.kenhBietTin.enabled}
                    onChange={(e) => patch(['scoring', 'rules', 'kenhBietTin', 'enabled'], e.target.checked)}
                    className="w-4 h-4 accent-brand-600" />
                  <div>
                    <div className="font-semibold text-slate-800 text-sm dark:text-slate-100">Kênh biết tin ứng tuyển</div>
                    <div className="text-xs text-slate-400">
                      Chọn "Bạn Bè, Người quen giới thiệu" → AI chấm <b>LOẠI (FAIL)</b> dù điểm cao · Quảng cáo FB/Tiktok/Instagram → bình thường
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                <div className="font-semibold text-slate-800 text-sm mb-2 dark:text-slate-100">Trình độ học vấn</div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Sinh viên ĐH/CĐ</label>
                    <input type="number" className="input" value={s.scoring.rules.trinhDo.scores.SinhVienDaiHoc_CaoDang}
                      onChange={(e) => patch(['scoring', 'rules', 'trinhDo', 'scores', 'SinhVienDaiHoc_CaoDang'], Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="label">Nghỉ học</label>
                    <input type="number" className="input" value={s.scoring.rules.trinhDo.scores.NghiHoc}
                      onChange={(e) => patch(['scoring', 'rules', 'trinhDo', 'scores', 'NghiHoc'], Number(e.target.value))} />
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                <div className="font-semibold text-slate-800 text-sm mb-2 dark:text-slate-100">Kinh nghiệm (AI phân loại)</div>
                <div className="grid sm:grid-cols-3 gap-3">
                  {(['NO_EXPERIENCE', 'OTHER_EXPERIENCE', 'FNB_EXPERIENCE'] as const).map((k) => (
                    <div key={k}>
                      <label className="label">{k}</label>
                      <input type="number" className="input" value={s.scoring.rules.kinhNghiem.scores[k]}
                        onChange={(e) => patch(['scoring', 'rules', 'kinhNghiem', 'scores', k], Number(e.target.value))} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-xs text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                <ShieldCheck size={15} /> AI chỉ ĐỀ XUẤT (AI_RECOMMENDATION). HR luôn là người quyết định (HR_DECISION).
              </div>
            </div>
          )}

          {tab === 'attendance' && (
            <div className="space-y-4">
              {(['SANG', 'CHIEU', 'TOI'] as const).map((k) => (
                <div key={k} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                  <div className="font-bold text-slate-800 text-sm mb-3 dark:text-slate-100">
                    Ca {k === 'SANG' ? 'SÁNG' : k === 'CHIEU' ? 'CHIỀU' : 'TỐI'}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="label">Giờ bắt đầu</label>
                      <input type="time" className="input" value={s.attendance.shifts[k].start}
                        onChange={(e) => patch(['attendance', 'shifts', k, 'start'], e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Giờ kết thúc</label>
                      <input type="time" className="input" value={s.attendance.shifts[k].end}
                        onChange={(e) => patch(['attendance', 'shifts', k, 'end'], e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Cho phép sớm (phút)</label>
                      <input type="number" className="input" value={s.attendance.shifts[k].windowMinutesBefore}
                        onChange={(e) => patch(['attendance', 'shifts', k, 'windowMinutesBefore'], Number(e.target.value))} />
                    </div>
                    <div>
                      <label className="label">Cho phép muộn (phút)</label>
                      <input type="number" className="input" value={s.attendance.shifts[k].windowMinutesAfter}
                        onChange={(e) => patch(['attendance', 'shifts', k, 'windowMinutesAfter'], Number(e.target.value))} />
                    </div>
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Số ngày đào tạo yêu cầu</label>
                  <input type="number" className="input" value={s.attendance.trainingDaysRequired}
                    onChange={(e) => patch(['attendance', 'trainingDaysRequired'], Number(e.target.value))} />
                </div>
                <div>
                  <label className="label">Hạn chót (ngày)</label>
                  <input type="number" className="input" value={s.attendance.trainingDeadlineDays}
                    onChange={(e) => patch(['attendance', 'trainingDeadlineDays'], Number(e.target.value))} />
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                Làm 1 hoặc 2 ca/ngày vẫn chỉ tính tối đa <b>1 ngày Training</b> mỗi ngày lịch.
              </div>
            </div>
          )}

          {tab === 'branches' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                <div>
                  <div className="font-semibold text-slate-800 text-sm dark:text-slate-100">{t('settings.geofence')}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{t('settings.branchesHint')}</div>
                </div>
                <input type="checkbox" className="w-5 h-5 accent-brand-600" checked={s.attendance.geofenceEnabled}
                  onChange={(e) => patch(['attendance', 'geofenceEnabled'], e.target.checked)} />
              </div>
              {s.branches.length === 0 && (
                <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-400 text-center dark:bg-slate-800/60">
                  Chưa có chi nhánh nào — thêm ít nhất 1 chi nhánh để bật geofence chấm công.
                </div>
              )}
              {s.branches.map((b, i) => (
                <div key={i} className="rounded-xl bg-slate-50 p-4 space-y-3 dark:bg-slate-800/60">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MapPin size={15} className="text-brand-500" />
                      <input className="input !w-56" placeholder={t('settings.branchName')} value={b.name}
                        onChange={(e) => patch(['branches', i, 'name'], e.target.value)} />
                    </div>
                    <button className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-500/10"
                      onClick={() => patch(['branches'], s.branches.filter((_, j) => j !== i))}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="label">{t('settings.lat')}</label>
                      <input type="number" step="0.000001" className="input" value={b.lat}
                        onChange={(e) => patch(['branches', i, 'lat'], Number(e.target.value))} placeholder="10.8231" />
                    </div>
                    <div>
                      <label className="label">{t('settings.lng')}</label>
                      <input type="number" step="0.000001" className="input" value={b.lng}
                        onChange={(e) => patch(['branches', i, 'lng'], Number(e.target.value))} placeholder="106.6297" />
                    </div>
                    <div>
                      <label className="label">{t('settings.radius')}</label>
                      <input type="number" min="0" className="input" value={b.radiusMeters}
                        onChange={(e) => patch(['branches', i, 'radiusMeters'], Number(e.target.value))} placeholder="300" />
                    </div>
                  </div>
                </div>
              ))}
              <button className="btn-secondary" onClick={() => patch(['branches'], [...s.branches, { name: '', lat: 10.8231, lng: 106.6297, radiusMeters: 300 }])}>
                <Plus size={15} /> {t('settings.addBranch')}
              </button>
            </div>
          )}

          {tab === 'notifications' && (
            <div className="space-y-4">
              <div>
                <label className="label">{t('settings.telegramBot')}</label>
                <input className="input font-mono text-xs" value={s.notifications.telegramBotToken}
                  onChange={(e) => patch(['notifications', 'telegramBotToken'], e.target.value)}
                  placeholder="123456:ABC-DEF..." />
              </div>
              <div>
                <label className="label">{t('settings.telegramChat')}</label>
                <input className="input" value={s.notifications.telegramChatId}
                  onChange={(e) => patch(['notifications', 'telegramChatId'], e.target.value)}
                  placeholder="123456789" />
              </div>
              <div>
                <label className="label">{t('settings.slackWebhook')}</label>
                <input className="input font-mono text-xs" value={s.notifications.slackWebhookUrl}
                  onChange={(e) => patch(['notifications', 'slackWebhookUrl'], e.target.value)}
                  placeholder="https://hooks.slack.com/services/..." />
              </div>
              <div>
                <label className="label">{t('settings.queueAlert')}</label>
                <input type="number" min="1" className="input" value={s.notifications.queueAlertMinutes}
                  onChange={(e) => patch(['notifications', 'queueAlertMinutes'], Number(e.target.value))} />
              </div>
              <div className="flex items-center gap-2">
                <button className="btn-secondary" onClick={sendTestNotification}>
                  <Bell size={15} /> {t('settings.testNotification')}
                </button>
                <span className="text-xs text-slate-400">Kiểm tra cả bell nội bộ + Telegram/Slack (nếu đã cấu hình).</span>
              </div>
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                Cũng có thể cấu hình qua <b>server/.env</b>: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SLACK_WEBHOOK_URL.
              </div>
            </div>
          )}

          {tab === 'security' && (
            <div className="space-y-5">
              <div className="rounded-xl bg-slate-50 p-4 space-y-3 dark:bg-slate-800/60">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className={cn('rounded-xl p-2.5', user?.twoFactorEnabled ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500')}>
                      <ShieldCheck size={20} />
                    </div>
                    <div>
                      <div className="font-bold text-slate-800 text-sm dark:text-slate-100">{t('settings.twoFactor')}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {user?.twoFactorEnabled ? t('settings.twoFactorEnabled') : t('settings.twoFactorDisabled')}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    {user?.twoFactorEnabled ? (
                      <>
                        <input className="input !w-32 text-center font-mono" placeholder="000000" inputMode="numeric"
                          value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                        <button className="btn-danger" disabled={twoFactorBusy || totpCode.length !== 6} onClick={() => void disableTwoFactor()}>
                          {twoFactorBusy ? <Spinner size={14} /> : <ShieldCheck size={14} />} {t('settings.disable2fa')}
                        </button>
                      </>
                    ) : (
                      <button className="btn-primary" disabled={twoFactorBusy} onClick={() => void startTwoFactorSetup()}>
                        {twoFactorBusy ? <Spinner size={14} /> : <ShieldCheck size={14} />} {t('settings.enable2fa')}
                      </button>
                    )}
                  </div>
                </div>
                {twoFactorSetup && (
                  <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 space-y-3 dark:border-brand-500/30 dark:bg-brand-500/10">
                    <p className="text-xs text-brand-700 dark:text-brand-300">{t('settings.scanQr')}</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <code className="font-mono text-[11px] bg-white rounded-lg px-3 py-2 break-all dark:bg-slate-900">{twoFactorSetup.secret}</code>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Hoặc mở link: <a href={twoFactorSetup.otpauthUrl} className="text-brand-600 underline break-all">{twoFactorSetup.otpauthUrl}</a>
                    </div>
                    <div className="flex items-center gap-2">
                      <input className="input !w-40 text-center font-mono tracking-widest" placeholder="000000" inputMode="numeric"
                        value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                      <button className="btn-primary" disabled={twoFactorBusy || totpCode.length !== 6} onClick={() => void confirmTwoFactor()}>
                        {twoFactorBusy ? <Spinner size={14} /> : null} {t('common.confirm')}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl bg-slate-50 p-4 space-y-3 dark:bg-slate-800/60">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl p-2.5 bg-slate-100 text-slate-500">
                    <KeyRound size={20} />
                  </div>
                  <div>
                    <div className="font-bold text-slate-800 text-sm dark:text-slate-100">{t('settings.changePassword')}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {user?.twoFactorEnabled ? 'Cần nhập mã 2FA khi đổi mật khẩu.' : 'Chỉ cần mật khẩu hiện tại.'}
                    </div>
                  </div>
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div>
                    <label className="label">{t('settings.oldPassword')}</label>
                    <input type="password" className="input" value={pwdForm.oldPassword}
                      onChange={(e) => setPwdForm({ ...pwdForm, oldPassword: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">{t('settings.newPassword')}</label>
                    <input type="password" className="input" value={pwdForm.newPassword}
                      onChange={(e) => setPwdForm({ ...pwdForm, newPassword: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">{t('settings.2faCode')} {user?.twoFactorEnabled ? '*' : '(nếu bật)'}</label>
                    <input className="input font-mono" value={pwdForm.totpCode}
                      onChange={(e) => setPwdForm({ ...pwdForm, totpCode: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button className="btn-primary" disabled={pwdBusy} onClick={() => void changePassword()}>
                    {pwdBusy && <Spinner size={14} />} {t('common.save')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'backup' && (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                {t('settings.backupHint')}
              </div>
              <div className="rounded-xl overflow-hidden border border-slate-100 dark:border-slate-800">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800/60">
                    <tr>
                      <th className="table-th">{t('settings.createdAt')}</th>
                      <th className="table-th">{t('settings.kind')}</th>
                      <th className="table-th">{t('settings.status')}</th>
                      <th className="table-th">{t('settings.size')}</th>
                      <th className="table-th">Drive</th>
                      <th className="table-th" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {backups.length === 0 && (
                      <tr><td colSpan={6} className="table-td text-center text-slate-400">Chưa có bản sao lưu nào.</td></tr>
                    )}
                    {backups.map((b) => (
                      <tr key={b.id}>
                        <td className="table-td text-slate-600 dark:text-slate-300">{new Date(b.createdAt).toLocaleString('vi-VN')}</td>
                        <td className="table-td">
                          <Badge className={b.kind === 'AUTO' ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}>
                            {b.kind === 'AUTO' ? t('settings.auto') : t('settings.manual')}
                          </Badge>
                        </td>
                        <td className="table-td">
                          <Badge className={b.status === 'OK' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'}>
                            {b.status}
                          </Badge>
                        </td>
                        <td className="table-td text-slate-500 dark:text-slate-400">{b.sizeBytes > 0 ? `${(b.sizeBytes / 1024).toFixed(1)} KB` : '—'}</td>
                        <td className="table-td text-slate-500 dark:text-slate-400">{b.driveId ? '✓' : '—'}</td>
                        <td className="table-td">
                          <div className="flex gap-1.5 justify-end">
                            {b.status === 'OK' && (
                              <>
                                <button className="btn-secondary !py-1 text-xs" onClick={() => downloadBackup(b)}>{t('settings.download')}</button>
                                {isAdmin && (
                                  <button className="btn-danger !py-1 text-xs" onClick={() => setRestoreTarget(b)}>{t('settings.restore')}</button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'conflicts' && (
            <div className="space-y-3">
              {data.conflicts.length === 0 && (
                <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">Không có xung đột nào đang mở.</div>
              )}
              {data.conflicts.map((c) => (
                <div key={c.id} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300">XUNG ĐỘT</Badge>
                    <span className="font-mono text-xs">{c.entityId}</span>
                    <span className="text-xs text-slate-400 ml-auto">field: {c.field} · web v{c.webVersion} / sheet v{c.sheetVersion}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="rounded-lg bg-white border border-slate-200 p-3 dark:bg-slate-900 dark:border-slate-700">
                      <div className="label">WEB</div>
                      <div className="text-xs font-mono text-slate-700 break-words dark:text-slate-300">{c.webValue || '—'}</div>
                    </div>
                    <div className="rounded-lg bg-white border border-slate-200 p-3 dark:bg-slate-900 dark:border-slate-700">
                      <div className="label">GOOGLE SHEET</div>
                      <div className="text-xs font-mono text-slate-700 break-words dark:text-slate-300">{c.sheetValue || '—'}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-success !py-1.5 text-xs" onClick={() => resolveConflict(c.id, 'WEB')}>GIỮ DỮ LIỆU WEB</button>
                    <button className="btn-primary !py-1.5 text-xs" onClick={() => resolveConflict(c.id, 'SHEET')}>GIỮ DỮ LIỆU SHEET</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'users' && (
            <div className="space-y-2">
              {data.users.map((u) => (
                <div key={u.id} className="rounded-xl bg-slate-50 px-4 py-3 space-y-2 dark:bg-slate-800/60">
                  <div className="flex items-center gap-3">
                    <div className="bg-brand-100 text-brand-700 rounded-full w-9 h-9 flex items-center justify-center font-bold uppercase dark:bg-brand-500/20 dark:text-brand-300">
                      {u.fullName.slice(0, 1)}
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-slate-800 text-sm dark:text-slate-100">{u.fullName}</div>
                      <div className="text-xs text-slate-400">{u.username}</div>
                    </div>
                    <Badge className={
                      u.role === 'ADMIN' ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300'
                        : u.role === 'HR' ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    }>
                      {u.role === 'ADMIN' ? 'QUẢN TRỊ' : u.role === 'HR' ? 'NHÂN SỰ' : 'XEM'}
                    </Badge>
                    {u.twoFactorEnabled && <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">2FA</Badge>}
                    {!u.active && <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">BỊ KHÓA</Badge>}
                  </div>
                  {isAdmin && u.id !== user?.id && (
                    <div className="flex items-center gap-2">
                      <input
                        className="input !py-1.5 text-xs"
                        placeholder={t('settings.branchScope')}
                        value={(u.branchScope ?? []).join(', ')}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const list = raw.split(',').map((x) => x.trim()).filter(Boolean);
                          void updateUserScope(u.id, list.length ? list : null);
                        }}
                        onBlur={() => void load()}
                      />
                      <span className="text-[11px] text-slate-400 shrink-0">{t('settings.branchScope')}</span>
                    </div>
                  )}
                </div>
              ))}
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                Thêm/sửa tài khoản: chạy script seed hoặc thao tác trực tiếp DB. Password được mã hóa bcrypt. 2FA kích hoạt từ tab Bảo mật.
              </div>
            </div>
          )}

          {tab === 'system' && user?.role === 'ADMIN' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="rounded-xl p-2.5 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <Settings2 size={20} />
                </div>
                <div>
                  <div className="font-bold text-slate-800 dark:text-slate-100">Hệ thống</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Reset hệ thống về trạng thái ban đầu khi cần bắt đầu lại từ đầu.
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-bold text-rose-700">
                      <Trash2 size={15} /> Reset toàn bộ dữ liệu
                    </div>
                    <div className="text-xs text-slate-600 mt-1 space-y-1">
                      <div>Xóa: ứng viên, điểm AI, training, chấm công, ca trực, sync jobs, audit, Zalo, webhook, conflicts.</div>
                      <div>Google Sheet: xóa dữ liệu 3 tab (giữ header). Xóa tombstone để form import lại từ đầu.</div>
                      <div className="font-semibold text-slate-700">GIỮ NGUYÊN: tài khoản đăng nhập + cấu hình Settings.</div>
                    </div>
                  </div>
                  <button className="btn-danger shrink-0" onClick={() => setResetOpen(true)}>
                    <RotateCcw size={14} /> Reset hệ thống
                  </button>
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                Sau khi reset, hệ thống sẽ tự nhập lại dữ liệu từ Google Form (nếu đã cấu hình Form Responses Sheet ID) mỗi 30 giây.
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={resetOpen}
        onClose={() => { setResetOpen(false); setResetConfirm(''); }}
        title="Reset hệ thống về trạng thái ban đầu"
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2.5 rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>
              Hành động này <b>xóa toàn bộ dữ liệu</b> (web + 3 tab Google Sheet) và <b>không thể hoàn tác</b>.
              Tài khoản đăng nhập và cấu hình được giữ nguyên.
            </span>
          </div>
          <div>
            <label className="label">Gõ <b className="text-rose-600">RESET</b> để xác nhận</label>
            <input
              className="input font-mono"
              value={resetConfirm}
              onChange={(e) => setResetConfirm(e.target.value)}
              placeholder="RESET"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => { setResetOpen(false); setResetConfirm(''); }}>Hủy</button>
            <button
              className="btn-danger"
              disabled={resetConfirm !== 'RESET' || resetting}
              onClick={async () => {
                setResetting(true);
                try {
                  const r = await api.post<{ db: Record<string, number>; sheets: Record<string, number> }>('/admin/reset', { confirm: 'RESET' });
                  const dbCount = Object.values(r.db).reduce((n, x) => n + x, 0);
                  const sheetCount = Object.values(r.sheets).filter((x) => x > 0).reduce((n, x) => n + x, 0);
                  toast('success', `Đã reset hệ thống: xóa ${dbCount} bản ghi web, ${sheetCount} dòng Google Sheet. Form sẽ tự nhập lại.`);
                  setResetOpen(false);
                  setResetConfirm('');
                  void load();
                } catch (e) {
                  toast('error', e instanceof ApiError ? e.message : 'Reset hệ thống thất bại.');
                } finally {
                  setResetting(false);
                }
              }}
            >
              {resetting ? <Spinner size={14} /> : <Trash2 size={14} />} Xác nhận reset
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => void doRestore()}
        title={t('settings.restore')}
        message={t('settings.restoreConfirm')}
        confirmLabel={t('settings.restore')}
        danger
      />
    </div>
  );
}