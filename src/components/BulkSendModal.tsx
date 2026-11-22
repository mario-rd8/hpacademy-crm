import { useState } from 'react';
import { CheckCircle2, FileText, Loader2, Paperclip, Send, Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { sendBulkMessages } from '../services/webhookService';
import type { Lead, MediaTemplate } from '../types/database.types';
import { applyTemplateVariables, formatPhoneMask } from '../utils/phone';

interface BulkSendModalProps {
  leads: Lead[];
  templates: MediaTemplate[];
  onClose: () => void;
  onSuccess: () => void;
}

export function BulkSendModal({ leads, templates, onClose, onSuccess }: BulkSendModalProps) {
  const { displayName } = useAuth();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(templates[0]?.id || '');
  const [customMessage, setCustomMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) || null;
  const leadsWithWhatsapp = leads.filter((l) => l.has_whatsapp);
  const previewLead = leadsWithWhatsapp[0] || leads[0];
  const rawBody = selectedTemplate ? selectedTemplate.body : customMessage;
  const previewText = previewLead ? applyTemplateVariables(rawBody, previewLead.name) : rawBody;

  async function handleSend() {
    setError(null);
    if (leadsWithWhatsapp.length === 0) {
      setError('Nenhum dos leads selecionados possui WhatsApp ativo.');
      return;
    }
    if (!selectedTemplate && !customMessage.trim()) {
      setError('Selecione um material da biblioteca ou escreva uma mensagem.');
      return;
    }

    setSending(true);
    try {
      await sendBulkMessages({
        leadIds: leadsWithWhatsapp.map((l) => l.id),
        templateId: selectedTemplate?.id ?? null,
        customMessage: selectedTemplate ? undefined : customMessage.trim(),
        sentBy: displayName,
      });
      setDone(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar lote para fila.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-[#012d63]/45 backdrop-blur-xs">
      <div className="w-full md:max-w-xl rounded-t-3xl md:rounded-3xl bg-white shadow-2xl border border-[#e5e9f0] animate-sheet-up max-h-[92dvh] flex flex-col">
        <div className="md:hidden flex justify-center pt-3 pb-1">
          <div className="h-1.5 w-12 rounded-full bg-[#cbd5e1]" />
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e9f0]">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-[#012d63]/10 text-[#012d63] flex items-center justify-center">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#012d63]">Disparo em Massa</h2>
              <p className="text-xs text-[#5a6577]">
                {leadsWithWhatsapp.length} de {leads.length} lead(s) aptos para WhatsApp
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[#8a94a6] hover:text-[#012d63] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Lista compacta de leads selecionados */}
          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-[#5a6577] mb-2">
              Destinatários ({leads.length})
            </span>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2.5 rounded-xl bg-[#f6f7f9] border border-[#e5e9f0]">
              {leads.map((lead) => (
                <span
                  key={lead.id}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                    lead.has_whatsapp
                      ? 'bg-white text-[#0f1f38] border border-[#e5e9f0]'
                      : 'bg-red-50 text-red-700 border border-red-200 line-through'
                  }`}
                >
                  {lead.name}
                  <span className="text-[10px] text-[#8a94a6]">
                    {formatPhoneMask(lead.phone)}
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* Seletor de Material */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#5a6577] mb-1.5">
              Material da Biblioteca
            </label>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] px-3.5 py-3 text-sm font-medium text-[#0f1f38] focus:border-[#012d63] focus:bg-white focus:outline-none"
            >
              <option value="">-- Digitar mensagem personalizada --</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.title} {tpl.file_name ? `(${tpl.file_name})` : ''}
                </option>
              ))}
            </select>
          </div>

          {!selectedTemplate && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#5a6577] mb-1.5">
                Mensagem (use {'{{nome}}'} para o primeiro nome)
              </label>
              <textarea
                rows={4}
                placeholder="Olá {{nome}}, tudo bem? Passando para compartilhar as novidades da HP Academy..."
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] p-3 text-sm text-[#0f1f38] focus:border-[#012d63] focus:bg-white focus:outline-none resize-none"
              />
            </div>
          )}

          {/* Preview */}
          {(previewText || selectedTemplate?.file_name) && (
            <div className="rounded-2xl bg-[#eef1f5] border border-[#e5e9f0] p-4 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[#5a6577]">
                <span>Preview ({previewLead?.name})</span>
                {selectedTemplate?.file_name && (
                  <span className="inline-flex items-center gap-1 text-[#012d63]">
                    <Paperclip className="h-3 w-3" />
                    {selectedTemplate.file_name}
                  </span>
                )}
              </div>
              {selectedTemplate?.file_url && selectedTemplate.file_type?.startsWith('image/') && (
                <img
                  src={selectedTemplate.file_url}
                  alt={selectedTemplate.title}
                  className="max-h-36 rounded-xl object-contain bg-white border border-[#e5e9f0]"
                />
              )}
              {selectedTemplate?.file_url && selectedTemplate.file_type === 'application/pdf' && (
                <div className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-[#012d63] border border-[#e5e9f0]">
                  <FileText className="h-4 w-4 text-[#eb5b29]" />
                  {selectedTemplate.file_name || 'Anexo PDF'}
                </div>
              )}
              <p className="text-sm text-[#0f1f38] whitespace-pre-wrap leading-relaxed">
                {previewText || <span className="italic text-[#8a94a6]">Sem legenda</span>}
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-medium text-red-700">
              {error}
            </div>
          )}

          {done && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-xs font-semibold text-emerald-700 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Lote enviado para a fila de disparos da Evolution API!
            </div>
          )}

          <div className="flex items-center gap-3 pt-2 safe-pb">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-[#e5e9f0] py-3 text-sm font-semibold text-[#5a6577] hover:bg-[#f6f7f9] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={sending || done}
              onClick={handleSend}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#eb5b29] hover:bg-[#d44d1f] text-white py-3 text-sm font-semibold shadow-md shadow-[#eb5b29]/25 disabled:opacity-60 cursor-pointer"
            >
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enfileirando...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Disparar ({leadsWithWhatsapp.length})
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
