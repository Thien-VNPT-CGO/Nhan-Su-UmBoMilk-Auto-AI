import { useEffect, useState, useCallback } from 'react';
import {
  FileSpreadsheet, BrainCircuit, MessageCircle, Scale, Clock, Users as UsersIcon,
  Save, AlertTriangle, ShieldCheck, RefreshCw,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Badge, Spinner } from '../components/ui';
import { useToast } from '../stores/Toast';
import { cn } from '../utils/format';

interface SettingsData {
  settings: {
    scoring: {
      passThreshold: number;
      rules: {
        hoTen: { enabled: boolean; score: number };
        namSinh: { enabled: boolean; score: number };
        queQuan: { enabled: boolean; score: number; allowed: string[] };
        sdt: { enabled: boolean; score: number };
        trinhDo: { enabled: boolean; scores: { SinhVienDaiHoc_CaoDang: number; NghiHoc: number } };
        kinhNghiem: { enabled: boolean; scores: { NO_EXPERIENCE: number; OTHER_EXPERIENCE: number; FNB_EXPERIENCE: number } };
        xuLy: { enabled: boolean; score: number };
        linkFb: { enabled: boolean; score: number };
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
    };
    ai: { provider: string; baseUrl: string; apiKey: string; model: string; temperature: number };
    googleSheet: {
      spreadsheetId: string;
      serviceAccountEmail: string;
      privateKey: string;
      formResponsesId: string;
      sheets: { locHoSo: string; diemUv: string; hoSoNv: string };
    };
    zalo: { oaId: string; accessToken: string; refreshToken: string };
  };
  googleSheetConfigured: boolean;
  demoMode: boolean;
  users: { id: string; username: string; fullName: string; role: string; active: boolean }[];
  conflicts: {
    id: string; entityId: string; field: string; webValue: string; sheetValue: string;
    webVersion: number; sheetVersion: number | null; createdAt: string;
  }[];
}

export default function Settings() {
  const { toast } = useToast();
  const [data, setData] = useState<SettingsData | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('sheet');

  const load = useCallback(async () => {
    try {
      const d = await api.get<SettingsData>('/settings');
      setData(d);
    } catch {
      toast('error', 'Không tải được cài đặt.');
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return <div className="flex justify-center py-20"><Spinner className="text-brand-500" size={28} /></div>;
  }

  const patch = (path: string[], value: unknown) => {
    setData((d) => {
      if (!d) return d;
      const clone = structuredClone(d);
      let cur: unknown = clone.settings;
      for (let i = 0; i < path.length - 1; i++) {
        cur = (cur as Record<string, unknown>)[path[i]];
      }
      (cur as Record<string, unknown>)[path[path.length - 1]] = value;
      return clone;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put<{ settings: unknown; provision?: { demo: boolean; created?: string[]; candidates?: number; error?: string } }>('/settings', data!.settings);
      if (r.provision) {
        if (r.provision.demo) {
          toast('success', 'Đã lưu. Google Sheet chưa được cấu hình — vẫn chạy DEMO MODE.');
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
      const r = await api.post<{ demo: boolean; created?: string[]; columnsAdded?: Record<string, string[]>; candidates?: number; enqueued?: number }>('/sync/provision');
      if (r.demo) {
        toast('success', `DEMO MODE: đã xếp hàng đồng bộ ${r.enqueued} hồ sơ (chưa có Google Sheet thật).`);
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

  const s = data.settings;
  const TABS = [
    { key: 'sheet', label: 'Google Sheet', icon: FileSpreadsheet },
    { key: 'ai', label: 'AI', icon: BrainCircuit },
    { key: 'zalo', label: 'Zalo', icon: MessageCircle },
    { key: 'scoring', label: 'Chấm điểm tuyển dụng', icon: Scale },
    { key: 'attendance', label: 'Chấm công', icon: Clock },
    { key: 'conflicts', label: 'Xung đột', icon: AlertTriangle },
    { key: 'users', label: 'Tài khoản', icon: UsersIcon },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">Cài đặt hệ thống</h1>
          <p className="text-sm text-slate-500">Chỉ ADMIN mới có thể chỉnh sửa</p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'sheet' && (
            <button className="btn-secondary" onClick={provision}>
              <FileSpreadsheet size={15} /> Tạo cấu trúc & đồng bộ
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
                tab === t.key ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50',
              )}
            >
              <t.icon size={16} />
              {t.label}
              {t.key === 'conflicts' && data.conflicts.length > 0 && (
                <Badge className="ml-auto bg-purple-100 text-purple-700">{data.conflicts.length}</Badge>
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
                  <div className="font-bold text-slate-800">
                    {data.googleSheetConfigured ? 'Đã cấu hình Google Sheet' : 'Chưa cấu hình (DEMO MODE)'}
                  </div>
                  <div className="text-xs text-slate-500">
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
                      const r = await api.post<{ imported: number; duplicates: number; invalid: number; lastError: string | null; lastRunAt: string | null }>('/sync/form-import', {});
                      if (r.lastError) toast('error', 'Lỗi: ' + r.lastError);
                      else toast('success', `Nhập xong: +${r.imported} mới · ${r.duplicates} trùng · ${r.invalid} lỗi${r.lastRunAt ? ' · lần chạy: ' + new Date(r.lastRunAt).toLocaleTimeString('vi-VN') : ''}`);
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
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500">
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
                  <input className="input" value={s.ai.model} onChange={(e) => patch(['ai', 'model'], e.target.value)} placeholder="gpt-4o-mini" />
                </div>
                <div>
                  <label className="label">Temperature</label>
                  <input type="number" step="0.1" min="0" max="2" className="input" value={s.ai.temperature}
                    onChange={(e) => patch(['ai', 'temperature'], Number(e.target.value))} />
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500">
                AI trả Structured JSON cho: trình độ học vấn, kinh nghiệm (NO_EXPERIENCE / OTHER_EXPERIENCE / FNB_EXPERIENCE), xử lý tình huống, quê quán, SĐT, Facebook.
              </div>
            </div>
          )}

          {tab === 'zalo' && (
            <div className="space-y-4">
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
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500">
                Webhook Zalo: POST <b>/api/zalo/webhook</b> (header x-webhook-secret). Khi ứng viên nhắn "ĐIỂM DANH" trong khung giờ ca, hệ thống tự điểm danh.
              </div>
            </div>
          )}

          {tab === 'scoring' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                <div>
                  <div className="font-bold text-slate-800 text-sm">Ngưỡng PASS (TONG_DIEM ≥)</div>
                  <div className="text-xs text-slate-500">AI_RECOMMENDATION = PASS nếu tổng điểm đạt ngưỡng</div>
                </div>
                <input
                  type="number" min="0" max="12" className="input !w-20 text-center font-extrabold"
                  value={s.scoring.passThreshold}
                  onChange={(e) => patch(['scoring', 'passThreshold'], Number(e.target.value))}
                />
              </div>

              {([
                ['hoTen', 'Họ tên (có dữ liệu)', 'score'],
                ['namSinh', 'Năm sinh (có dữ liệu)', 'score'],
                ['queQuan', 'Quê quán (Miền Tây / TP.HCM)', 'score'],
                ['sdt', 'SĐT hợp lệ', 'score'],
                ['xuLy', 'Xử lý tình huống (có trả lời)', 'score'],
                ['linkFb', 'Facebook (CO_VE_CHINH_CHU)', 'score'],
              ] as const).map(([key, label, field]) => {
                const rule = s.scoring.rules[key];
                return (
                  <div key={key} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <input type="checkbox" checked={rule.enabled} onChange={(e) => patch(['scoring', 'rules', key, 'enabled'], e.target.checked)} className="w-4 h-4 accent-brand-600" />
                      <div>
                        <div className="font-semibold text-slate-800 text-sm">{label}</div>
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

              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="font-semibold text-slate-800 text-sm mb-2">Trình độ học vấn</div>
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

              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="font-semibold text-slate-800 text-sm mb-2">Kinh nghiệm (AI phân loại)</div>
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

              <div className="flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-xs text-brand-700">
                <ShieldCheck size={15} /> AI chỉ ĐỀ XUẤT (AI_RECOMMENDATION). HR luôn là người quyết định (HR_DECISION).
              </div>
            </div>
          )}

          {tab === 'attendance' && (
            <div className="space-y-4">
              {(['SANG', 'CHIEU', 'TOI'] as const).map((k) => (
                <div key={k} className="rounded-xl bg-slate-50 p-4">
                  <div className="font-bold text-slate-800 text-sm mb-3">
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
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500">
                Làm 1 hoặc 2 ca/ngày vẫn chỉ tính tối đa <b>1 ngày Training</b> mỗi ngày lịch.
              </div>
            </div>
          )}

          {tab === 'conflicts' && (
            <div className="space-y-3">
              {data.conflicts.length === 0 && (
                <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">Không có xung đột nào đang mở.</div>
              )}
              {data.conflicts.map((c) => (
                <div key={c.id} className="rounded-xl bg-slate-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className="bg-purple-100 text-purple-700">XUNG ĐỘT</Badge>
                    <span className="font-mono text-xs">{c.entityId}</span>
                    <span className="text-xs text-slate-400 ml-auto">field: {c.field} · web v{c.webVersion} / sheet v{c.sheetVersion}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="rounded-lg bg-white border border-slate-200 p-3">
                      <div className="label">WEB</div>
                      <div className="text-xs font-mono text-slate-700 break-words">{c.webValue || '—'}</div>
                    </div>
                    <div className="rounded-lg bg-white border border-slate-200 p-3">
                      <div className="label">GOOGLE SHEET</div>
                      <div className="text-xs font-mono text-slate-700 break-words">{c.sheetValue || '—'}</div>
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
                <div key={u.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
                  <div className="bg-brand-100 text-brand-700 rounded-full w-9 h-9 flex items-center justify-center font-bold uppercase">
                    {u.fullName.slice(0, 1)}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-slate-800 text-sm">{u.fullName}</div>
                    <div className="text-xs text-slate-400">{u.username}</div>
                  </div>
                  <Badge className={
                    u.role === 'ADMIN' ? 'bg-purple-100 text-purple-700'
                      : u.role === 'HR' ? 'bg-brand-100 text-brand-700'
                        : 'bg-slate-100 text-slate-600'
                  }>
                    {u.role === 'ADMIN' ? 'QUẢN TRỊ' : u.role === 'HR' ? 'NHÂN SỰ' : 'XEM'}
                  </Badge>
                  {!u.active && <Badge className="bg-rose-100 text-rose-700">BỊ KHÓA</Badge>}
                </div>
              ))}
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500">
                Thêm/sửa tài khoản: chạy script seed hoặc thao tác trực tiếp DB. Password được mã hóa bcrypt.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}