import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, CheckCircle2, Milk } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Field, Spinner } from '../components/ui';
import { useToast } from '../stores/Toast';

const BRANCHES = ['Hoc Mon', 'Quận 12', 'Go Vap', 'Thu Duc', 'Binh Tan', 'Tan Binh'];
const SHIFTS = ['SÁNG', 'CHIỀU', 'TỐI', 'CA 2 (SÁNG + CHIỀU)', 'CA 3 (SÁNG + TỐI)'];

const EMPTY = {
  tenUv: '', namSinh: '', trinhDo: '', queQuan: '',
  sdtZalo: '', caLam: '', chiNhanh: '', kinhNghiem: '', xuLy: '', linkFb: '',
};

export default function DangKy() {
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ id: string } | null>(null);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.tenUv.trim() || !form.sdtZalo.trim()) {
      toast('error', 'Vui lòng nhập Họ tên và SĐT / Zalo.');
      return;
    }
    setSending(true);
    try {
      const d = await api.post<{ id: string }>('/webhooks/form', form);
      setDone(d);
      setForm(EMPTY);
      toast('success', 'Đăng ký thành công! Chúng tôi sẽ liên hệ bạn sớm.');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Đăng ký thất bại.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-violet-50 flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        <div className="text-center mb-5">
          <div className="inline-flex items-center gap-2 text-2xl font-black text-brand-600">
            <Milk size={28} /> UMBO MILK
          </div>
          <p className="text-sm text-slate-500 mt-1">Đăng ký ứng tuyển – Nhân viên pha chế & cửa hàng</p>
        </div>

        {done ? (
          <div className="card p-8 text-center space-y-3">
            <CheckCircle2 size={44} className="mx-auto text-emerald-500" />
            <h2 className="text-lg font-extrabold text-slate-800">Đăng ký thành công!</h2>
            <p className="text-sm text-slate-500">
              Mã hồ sơ của bạn: <b className="font-mono text-brand-600">{done.id}</b>
            </p>
            <p className="text-sm text-slate-500">Bộ phận tuyển dụng sẽ liên hệ qua Zalo để sắp lịch phỏng vấn.</p>
            <button className="btn-secondary mt-2" onClick={() => setDone(null)}>Đăng ký thêm hồ sơ</button>
          </div>
        ) : (
          <div className="card p-6 space-y-4">
            <h1 className="text-lg font-extrabold text-slate-800">Form đăng ký tuyển dụng</h1>

            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Họ và tên *">
                <input className="input" value={form.tenUv} onChange={set('tenUv')} placeholder="VD: Nguyễn Văn A" />
              </Field>
              <Field label="Năm sinh">
                <input className="input" value={form.namSinh} onChange={set('namSinh')} placeholder="VD: 2004" />
              </Field>
              <Field label="Trình độ">
                <select className="input" value={form.trinhDo} onChange={set('trinhDo')}>
                  <option value="">-- Chọn --</option>
                  <option>Đang học Đại học / Cao đẳng</option>
                  <option>Đang học Cấp 3</option>
                  <option>Đã tốt nghiệp</option>
                  <option>Đang đi làm thêm</option>
                </select>
              </Field>
              <Field label="Quê quán">
                <input className="input" value={form.queQuan} onChange={set('queQuan')} placeholder="VD: Tiền Giang" />
              </Field>
              <Field label="SĐT / Zalo *">
                <input className="input" value={form.sdtZalo} onChange={set('sdtZalo')} placeholder="VD: 0901234567" />
              </Field>
              <Field label="Ca mong muốn">
                <select className="input" value={form.caLam} onChange={set('caLam')}>
                  <option value="">-- Chọn --</option>
                  {SHIFTS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Chi nhánh">
                <select className="input" value={form.chiNhanh} onChange={set('chiNhanh')}>
                  <option value="">-- Chọn --</option>
                  {BRANCHES.map((b) => <option key={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Kinh nghiệm">
                <select className="input" value={form.kinhNghiem} onChange={set('kinhNghiem')}>
                  <option value="">-- Chọn --</option>
                  <option>Chưa có kinh nghiệm</option>
                  <option>Có kinh nghiệm khác</option>
                  <option>Đã làm trà sữa / F&B</option>
                </select>
              </Field>
            </div>

            <Field label="Nếu bận đúng giờ làm việc, bạn xử lý thế nào?">
              <textarea className="input min-h-[70px]" value={form.xuLy} onChange={set('xuLy')} placeholder="VD: Em sẽ báo quản lý và nhờ bạn đổi ca..." />
            </Field>
            <Field label="Link Facebook cá nhân">
              <input className="input" value={form.linkFb} onChange={set('linkFb')} placeholder="https://facebook.com/..." />
            </Field>

            <button className="btn-primary w-full py-3" onClick={submit} disabled={sending}>
              {sending ? <Spinner size={16} /> : <Send size={16} />} Gửi đăng ký
            </button>

            <p className="text-[11px] text-slate-400 text-center">
              Bằng việc gửi đăng ký, bạn đồng ý để UMBO MILK liên hệ qua SĐT / Zalo đã cung cấp.
            </p>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-4">
          <Link to="/login" className="hover:text-brand-500">← Quản trị viên đăng nhập</Link>
        </p>
      </div>
    </div>
  );
}