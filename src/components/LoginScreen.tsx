import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2, Lock, Phone } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatPhoneMask, isValidBrPhone } from '../utils/phone';
import { EvaFlowBadge } from './EvaFlowBadge';

export function LoginScreen() {
  const { signInWithPhone } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isValidBrPhone(phone)) {
      setError('Digite um número de telefone válido com DDD (ex: (81) 99500-8282).');
      return;
    }

    if (!password.trim()) {
      setError('Digite sua senha de acesso.');
      return;
    }

    setSubmitting(true);
    try {
      await signInWithPhone(phone, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col justify-between bg-[#012d63] relative overflow-hidden">
      {/* Detalhes sutis de fundo */}
      <div
        className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, #eb5b29 0%, transparent 70%)' }}
      />
      <div
        className="pointer-events-none absolute -bottom-40 -left-32 h-96 w-96 rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, #38bdf8 0%, transparent 70%)' }}
      />

      <main className="relative z-10 flex-1 flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          {/* Logo HP Academy */}
          <div className="flex flex-col items-center mb-8">
            <img
              src="/assets/HPAcademy_horizontal-negativa.svg"
              alt="HP Academy"
              className="h-11 sm:h-12 w-auto mb-3"
            />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-3 py-1 text-[11px] font-semibold tracking-[0.14em] uppercase text-white/90">
              <span className="h-1.5 w-1.5 rounded-full bg-[#eb5b29]" />
              CRM Comercial
            </span>
          </div>

          {/* Card de Login */}
          <div className="rounded-3xl bg-white p-6 sm:p-8 shadow-2xl shadow-[#001433]/40 border border-white/20">
            <div className="mb-6">
              <h1 className="text-xl font-bold text-[#012d63] tracking-tight">
                Acesse sua conta
              </h1>
              <p className="text-sm text-[#5a6577] mt-1">
                Entre com seu telefone cadastrado e senha.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="login-phone"
                  className="block text-xs font-semibold uppercase tracking-wider text-[#5a6577] mb-1.5"
                >
                  Telefone
                </label>
                <div className="relative">
                  <Phone className="h-4 w-4 text-[#8a94a6] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="login-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="(81) 99999-9999"
                    value={phone}
                    onChange={(e) => setPhone(formatPhoneMask(e.target.value))}
                    className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] pl-10 pr-4 py-3.5 text-base font-medium text-[#0f1f38] placeholder:text-[#8a94a6] focus:border-[#012d63] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#012d63]/15 transition-all"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-xs font-semibold uppercase tracking-wider text-[#5a6577] mb-1.5"
                >
                  Senha
                </label>
                <div className="relative">
                  <Lock className="h-4 w-4 text-[#8a94a6] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] pl-10 pr-12 py-3.5 text-base font-medium text-[#0f1f38] placeholder:text-[#8a94a6] focus:border-[#012d63] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#012d63]/15 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label="Mostrar ou ocultar senha"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-[#8a94a6] hover:text-[#012d63] transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-medium text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 flex items-center justify-center gap-2 rounded-xl bg-[#eb5b29] hover:bg-[#d44d1f] active:scale-[0.99] text-white font-semibold py-3.5 text-base shadow-lg shadow-[#eb5b29]/25 disabled:opacity-60 transition-all cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Entrando...
                  </>
                ) : (
                  'Entrar no CRM'
                )}
              </button>
            </form>
          </div>

          <p className="text-center text-xs text-white/55 mt-6">
            crm.hpacademy.com.br · Acesso exclusivo da equipe comercial
          </p>
        </div>
      </main>

      <EvaFlowBadge light />
    </div>
  );
}
