import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Milk, Lock, User, Loader2, ShieldCheck, ArrowLeft } from 'lucide-react';
import { useAuth } from '../stores/auth';
import { useToast } from '../stores/Toast';
import { useI18n } from '../utils/i18n';
import { ApiError } from '../api/client';

export default function Login() {
  const { login, verifyTwoFactor } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await login(username, password);
      if (result.needsTwoFactor && result.twoFactorToken) {
        setTwoFactorToken(result.twoFactorToken);
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : 'Đăng nhập thất bại.');
    } finally {
      setLoading(false);
    }
  };

  const submitTotp = async (e: FormEvent) => {
    e.preventDefault();
    if (!twoFactorToken) return;
    setLoading(true);
    try {
      await verifyTwoFactor(twoFactorToken, totpCode);
      navigate('/dashboard');
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : 'Sai mã xác thực.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-brand-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex bg-brand-600 text-white rounded-2xl p-4 mb-4">
            <Milk size={32} />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">UMBO MILK</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('login.subtitle')}</p>
        </div>

        {!twoFactorToken ? (
          <form onSubmit={submit} className="card p-6 space-y-4">
            <div>
              <label className="label">{t('login.username')}</label>
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
              <label className="label">{t('login.password')}</label>
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
              {t('login.submit')}
            </button>
          </form>
        ) : (
          <form onSubmit={submitTotp} className="card p-6 space-y-4">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
              <ShieldCheck size={18} className="text-brand-600" />
              <span className="font-bold text-sm">{t('login.twoFactorTitle')}</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('login.twoFactorHint')}</p>
            <div>
              <label className="label">{t('settings.2faCode')}</label>
              <input
                className="input text-center tracking-[0.4em] font-mono"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                autoFocus
                required
              />
            </div>
            <button className="btn-primary w-full py-2.5" disabled={loading || totpCode.length !== 6}>
              {loading && <Loader2 size={16} className="animate-spin" />}
              {t('login.verify')}
            </button>
            <button
              type="button"
              onClick={() => setTwoFactorToken(null)}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 inline-flex items-center justify-center gap-1"
            >
              <ArrowLeft size={12} /> {t('common.back')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}