import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Phone,
  QrCode,
  RefreshCw,
  Smartphone,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import {
  createWhatsAppInstance,
  fetchWhatsAppStatus,
  reconnectWhatsAppInstance,
  sanitizeInstanceSlug,
} from '../services/whatsappService';
import type { WhatsAppConnectionStatus, WhatsAppSettings } from '../types/database.types';
import { formatPhoneMask, isValidBrPhone } from '../utils/phone';

const STATUS_UI: Record<
  WhatsAppConnectionStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  connected: {
    label: 'Conectado',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotClass: 'bg-emerald-500 animate-pulse',
  },
  connecting: {
    label: 'Aguardando leitura do QR',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    dotClass: 'bg-amber-500 animate-pulse',
  },
  disconnected: {
    label: 'Desconectado',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    dotClass: 'bg-rose-500',
  },
};

export function WhatsAppConnectionCard() {
  const [settings, setSettings] = useState<WhatsAppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Modal Nova Instância / Trocar Número
  const [formOpen, setFormOpen] = useState(false);
  const [instanceInput, setInstanceInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [submittingForm, setSubmittingForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Modal Leitura do QR Code
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);

  const loadStatus = useCallback(async (silent = false) => {
    if (!silent) setChecking(true);
    setError(null);
    try {
      const data = await fetchWhatsAppStatus();
      setSettings(data);
      return data;
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Erro ao verificar conexão WhatsApp.');
      }
      return null;
    } finally {
      setLoading(false);
      if (!silent) setChecking(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Escuta Supabase Realtime na tabela crm.whatsapp_settings
  useEffect(() => {
    const channel = supabase
      .channel('crm-whatsapp-settings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'crm', table: 'whatsapp_settings' },
        (payload) => {
          const row = payload.new as
            | { instance_name?: string; phone?: string; status?: WhatsAppConnectionStatus; updated_at?: string }
            | undefined;
          if (!row?.instance_name) return;
          setSettings({
            configured: true,
            instance_name: row.instance_name,
            phone: row.phone || '',
            status: row.status || 'disconnected',
            updated_at: row.updated_at || null,
          });
          if (row.status === 'connected' && qrModalOpen) {
            setQrModalOpen(false);
            setQrImage(null);
            setSuccessToast('WhatsApp conectado com sucesso! Pronto para disparos.');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qrModalOpen]);

  // Polling automático a cada 3s enquanto o modal do QR Code estiver aberto
  useEffect(() => {
    if (!qrModalOpen) return;
    const timer = window.setInterval(async () => {
      const latest = await loadStatus(true);
      if (latest?.status === 'connected') {
        setQrModalOpen(false);
        setQrImage(null);
        setSuccessToast('WhatsApp conectado com sucesso! Pronto para disparos.');
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [qrModalOpen, loadStatus]);

  // Auto-oculta confirmação de sucesso após 6 segundos
  useEffect(() => {
    if (!successToast) return;
    const t = window.setTimeout(() => setSuccessToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [successToast]);

  async function handleReconnect() {
    setError(null);
    setLoadingQr(true);
    try {
      const res = await reconnectWhatsAppInstance();
      if (res.alreadyConnected) {
        await loadStatus(true);
        setSuccessToast('Esta instância já está conectada!');
        return;
      }
      setQrImage(res.qrcode || null);
      setPairingCode(res.pairingCode || null);
      setQrModalOpen(true);
      await loadStatus(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível gerar o QR Code.');
    } finally {
      setLoadingQr(false);
    }
  }

  function openSwitchModal() {
    setInstanceInput('');
    setPhoneInput('');
    setFormError(null);
    setFormOpen(true);
  }

  async function handleCreateInstance(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const slug = sanitizeInstanceSlug(instanceInput).replace(/^[-_]+|[-_]+$/g, '');
    if (slug.length < 3) {
      setFormError('Digite um nome de instância com pelo menos 3 caracteres (ex: hp-comercial-01).');
      return;
    }
    if (!isValidBrPhone(phoneInput)) {
      setFormError('Digite um número de celular válido com DDD (ex: (81) 99999-9999).');
      return;
    }

    setSubmittingForm(true);
    try {
      const res = await createWhatsAppInstance({
        instanceName: slug,
        phone: phoneInput,
      });
      setFormOpen(false);
      setSettings({
        configured: true,
        instance_name: res.instance_name || slug,
        phone: res.phone || phoneInput,
        status: res.status || 'connecting',
        updated_at: new Date().toISOString(),
      });
      if (res.qrcode) {
        setQrImage(res.qrcode);
        setPairingCode(res.pairingCode || null);
        setQrModalOpen(true);
      } else {
        setSuccessToast('Instância criada! Clique em "Gerar QR Code" se o código não aparecer.');
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao criar instância.');
    } finally {
      setSubmittingForm(false);
    }
  }

  const statusInfo = settings ? STATUS_UI[settings.status] : STATUS_UI.disconnected;
  const sanitizedPreview = sanitizeInstanceSlug(instanceInput).replace(/^[-_]+|[-_]+$/g, '');

  return (
    <section className="rounded-2xl bg-white border border-[#e5e9f0] p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#012d63]/10 text-[#012d63] flex items-center justify-center shrink-0">
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#012d63]">
              Conexão WhatsApp (Evolution API)
            </h2>
            <p className="text-xs text-[#5a6577]">
              Instância ativa usada nos disparos individuais e em massa do CRM.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={checking || loading}
          onClick={() => loadStatus(false)}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] hover:bg-[#eef1f5] px-3.5 py-2 text-xs font-semibold text-[#012d63] disabled:opacity-60 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
          Atualizar status
        </button>
      </div>

      {successToast && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs font-semibold text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{successToast}</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs font-medium text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl bg-[#f6f7f9] border border-[#e5e9f0] p-6 flex items-center justify-center gap-2 text-xs font-medium text-[#5a6577]">
          <Loader2 className="h-4 w-4 animate-spin text-[#012d63]" />
          Verificando conexão com a Evolution API...
        </div>
      ) : !settings?.configured ? (
        <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f6f7f9] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <WifiOff className="h-5 w-5 text-[#8a94a6] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-[#012d63]">Nenhuma instância configurada</p>
              <p className="text-xs text-[#5a6577] mt-0.5">
                Cadastre o número comercial da HP Academy para ativar os disparos pelo CRM.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openSwitchModal}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#eb5b29] hover:bg-[#d44d1f] text-white px-4 py-2.5 text-xs font-bold shadow-sm shadow-[#eb5b29]/25 cursor-pointer shrink-0"
          >
            <QrCode className="h-4 w-4" />
            Conectar WhatsApp
          </button>
        </div>
      ) : (
        <div className="rounded-2xl bg-[#f6f7f9] border border-[#e5e9f0] p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-[#0f1f38]">
                  {settings.instance_name}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusInfo.badgeClass}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${statusInfo.dotClass}`} />
                  {statusInfo.label}
                </span>
              </div>
              <p className="text-xs font-semibold text-[#5a6577] tabular-nums flex items-center gap-1.5">
                {settings.status === 'connected' ? (
                  <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-rose-500" />
                )}
                {settings.phone ? formatPhoneMask(settings.phone) : 'Número não informado'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {settings.status !== 'connected' && (
                <button
                  type="button"
                  disabled={loadingQr}
                  onClick={handleReconnect}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#eb5b29] hover:bg-[#d44d1f] text-white px-4 py-2.5 text-xs font-bold shadow-sm shadow-[#eb5b29]/25 disabled:opacity-60 cursor-pointer"
                >
                  {loadingQr ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <QrCode className="h-3.5 w-3.5" />
                  )}
                  Gerar QR Code
                </button>
              )}

              <button
                type="button"
                onClick={openSwitchModal}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#012d63] hover:bg-[#001f47] text-white px-4 py-2.5 text-xs font-bold cursor-pointer"
              >
                <Phone className="h-3.5 w-3.5" />
                Trocar número
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal / Bottom Sheet: Nova Instância / Trocar Número */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-[#012d63]/45 backdrop-blur-xs">
          <div className="w-full md:max-w-md rounded-t-3xl md:rounded-3xl bg-white shadow-2xl border border-[#e5e9f0] animate-sheet-up max-h-[92dvh] flex flex-col">
            <div className="md:hidden flex justify-center pt-3 pb-1">
              <div className="h-1.5 w-12 rounded-full bg-[#cbd5e1]" />
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e9f0]">
              <div>
                <h3 className="text-base font-bold text-[#012d63]">
                  {settings?.configured ? 'Trocar número WhatsApp' : 'Nova instância WhatsApp'}
                </h3>
                <p className="text-xs text-[#5a6577]">
                  O CRM opera com 1 número ativo por vez.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="p-2 rounded-xl text-[#8a94a6] hover:text-[#012d63] cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateInstance} className="p-6 space-y-4 overflow-y-auto">
              {settings?.configured && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3 flex items-start gap-2.5 text-xs text-amber-900">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    Ao confirmar, a instância atual (<strong>{settings.instance_name}</strong>) será
                    substituída por este novo número em todos os disparos do CRM.
                  </span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#5a6577] mb-1.5">
                  Nome da instância
                </label>
                <input
                  type="text"
                  autoFocus
                  placeholder="Ex: hp-comercial-01"
                  value={instanceInput}
                  onChange={(e) => setInstanceInput(e.target.value)}
                  className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] px-3.5 py-3 text-sm font-medium text-[#0f1f38] focus:border-[#012d63] focus:bg-white focus:outline-none"
                />
                {sanitizedPreview && (
                  <p className="text-[11px] text-[#8a94a6] mt-1">
                    Identificador na Evolution API:{' '}
                    <code className="font-mono font-semibold text-[#012d63]">
                      {sanitizedPreview}
                    </code>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#5a6577] mb-1.5">
                  Novo número (WhatsApp)
                </label>
                <div className="relative">
                  <Phone className="h-4 w-4 text-[#8a94a6] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="(81) 99999-9999"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(formatPhoneMask(e.target.value))}
                    className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] pl-10 pr-4 py-3 text-sm font-medium text-[#0f1f38] tabular-nums focus:border-[#012d63] focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              {formError && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-medium text-red-700">
                  {formError}
                </div>
              )}

              <div className="flex items-center gap-3 pt-2 safe-pb">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="flex-1 rounded-xl border border-[#e5e9f0] py-3 text-sm font-semibold text-[#5a6577] hover:bg-[#f6f7f9] cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingForm}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#eb5b29] hover:bg-[#d44d1f] text-white py-3 text-sm font-bold shadow-md shadow-[#eb5b29]/25 disabled:opacity-60 cursor-pointer"
                >
                  {submittingForm ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <QrCode className="h-4 w-4" />
                  )}
                  Criar e Gerar QR Code
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal / Bottom Sheet: Leitura do QR Code */}
      {qrModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-[#012d63]/55 backdrop-blur-xs">
          <div className="w-full md:max-w-md rounded-t-3xl md:rounded-3xl bg-white shadow-2xl border border-[#e5e9f0] animate-sheet-up">
            <div className="md:hidden flex justify-center pt-3 pb-1">
              <div className="h-1.5 w-12 rounded-full bg-[#cbd5e1]" />
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e9f0]">
              <div>
                <h3 className="text-base font-bold text-[#012d63]">Escaneie o QR Code</h3>
                <p className="text-xs text-[#5a6577]">
                  Instância: <strong>{settings?.instance_name}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQrModalOpen(false)}
                className="p-2 rounded-xl text-[#8a94a6] hover:text-[#012d63] cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 flex flex-col items-center text-center space-y-4 safe-pb">
              <div className="rounded-2xl bg-white p-5 border border-[#e5e9f0] shadow-inner flex items-center justify-center min-h-[260px] min-w-[260px]">
                {qrImage ? (
                  <img
                    src={qrImage}
                    alt="QR Code WhatsApp"
                    className="h-60 w-60 object-contain"
                  />
                ) : (
                  <Loader2 className="h-8 w-8 animate-spin text-[#012d63]" />
                )}
              </div>

              {pairingCode && (
                <div className="rounded-xl bg-[#f6f7f9] border border-[#e5e9f0] px-4 py-2 text-xs text-[#5a6577]">
                  Código de pareamento:{' '}
                  <strong className="font-mono text-sm text-[#012d63] tracking-widest">
                    {pairingCode}
                  </strong>
                </div>
              )}

              <div className="space-y-1 text-xs text-[#5a6577] max-w-xs">
                <p>
                  No celular, abra o <strong>WhatsApp</strong> →{' '}
                  <strong>Dispositivos conectados</strong> → <strong>Conectar aparelho</strong>.
                </p>
                <p className="inline-flex items-center gap-1.5 text-[#012d63] font-semibold pt-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#eb5b29]" />
                  Aguardando leitura automática...
                </p>
              </div>

              <div className="flex items-center gap-3 w-full pt-1">
                <button
                  type="button"
                  disabled={loadingQr}
                  onClick={handleReconnect}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#e5e9f0] py-3 text-xs font-bold text-[#012d63] hover:bg-[#f6f7f9] disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingQr ? 'animate-spin' : ''}`} />
                  Atualizar QR
                </button>
                <button
                  type="button"
                  onClick={() => setQrModalOpen(false)}
                  className="flex-1 rounded-xl bg-[#012d63] text-white py-3 text-xs font-bold cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
