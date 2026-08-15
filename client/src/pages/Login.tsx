import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Milk, Lock, User, Loader2 } from 'lucide-react';
import { useAuth } from '../stores/auth';
import { useToast } from '../stores/Toast';
import { ApiError } from '../api/client';

export default function Login() {
  const { login } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(username, password);
      navigate('/dashboard');
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : 'Đăng nhập thất bại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-brand-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex bg-brand-600 text-white rounded-2xl p-4 mb-4">
            <Milk size={32} />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800">UMBO MILK</h1>
          <p className="text-sm text-slate-500 mt-1">AI Recruitment & Training System</p>
        </div>

        <form onSubmit={submit} className="card p-6 space-y-4">
          <div>
            <label className="label">Tên đăng nhập</label>
            <div className="relative">
              <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="input pl-9"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="hr_umbomilk"
                autoComplete="username"
                required
              />
            </div>
          </div>
          <div>
            <label className="label">Mật khẩu</label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                className="input pl-9"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>
          </div>
          <button className="btn-primary w-full py-2.5" disabled={loading}>
            {loading && <Loader2 size={16} className="animate-spin" />}
            Đăng nhập
          </button>
          <p className="text-[11px] text-center text-slate-400">
            Tài khoản mặc định: hr_umbomilk/hr123456 · viewer/view1234
          </p>
          <p className="text-[12px] text-center">
            <Link to="/dang-ky" className="text-brand-500 hover:underline">
              Ứng viên đăng ký tuyển dụng tại đây →
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}