import { useState, type FormEvent } from 'react';
import { Loader2, Phone, User, X } from 'lucide-react';
import type { Stage, Tag } from '../types/database.types';
import { formatPhoneMask, isValidBrPhone } from '../utils/phone';

interface NewLeadModalProps {
  stages: Stage[];
  tags: Tag[];
  defaultStageId?: string;
  onClose: () => void;
  onCreate: (input: {
    name: string;
    phone: string;
    stageId: string;
    tagIds: string[];
    hasWhatsapp: boolean;
  }) => Promise<{ id: string; existed: boolean }>;
}

export function NewLeadModal({
  stages,
  tags,
  defaultStageId,
  onClose,
  onCreate,
}: NewLeadModalProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [stageId, setStageId] = useState(defaultStageId || stages[0]?.id || '');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [hasWhatsapp, setHasWhatsapp] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleTag(id: string) {
    setSelectedTags((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Informe o nome do lead.');
      return;
    }
    if (!isValidBrPhone(phone)) {
      setError('Informe um telefone válido com DDD (ex: (81) 99999-9999).');
      return;
    }
    if (!stageId) {
      setError('Selecione uma etapa do funil.');
      return;
    }

    setSubmitting(true);
    try {
      await onCreate({
        name: name.trim(),
        phone,
        stageId,
        tagIds: selectedTags,
        hasWhatsapp,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar lead.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-[#012d63]/45 backdrop-blur-xs">
      <div className="w-full md:max-w-lg rounded-t-3xl md:rounded-3xl bg-white shadow-2xl border border-[#e5e9f0] animate-sheet-up max-h-[92dvh] flex flex-col">
        {/* Handle mobile */}
        <div className="md:hidden flex justify-center pt-3 pb-1">
          <div className="h-1.5 w-12 rounded-full bg-[#cbd5e1]" />
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e9f0]">
          <div>
            <h2 className="text-lg font-bold text-[#012d63]">Novo Lead</h2>
            <p className="text-xs text-[#5a6577]">
              Se o telefone já existir, o card atual será atualizado.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[#8a94a6] hover:text-[#012d63] hover:bg-[#f6f7f9] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#5a6577] mb-1.5">
              Nome completo
            </label>
            <div className="relative">
              <User className="h-4 w-4 text-[#8a94a6] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                autoFocus
                placeholder="Ex: Maria Clara Silva"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] pl-10 pr-4 py-3 text-sm font-medium text-[#0f1f38] focus:border-[#012d63] focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#5a6577] mb-1.5">
              Telefone (WhatsApp)
            </label>
            <div className="relative">
              <Phone className="h-4 w-4 text-[#8a94a6] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="tel"
                inputMode="numeric"
                placeholder="(81) 99999-9999"
                value={phone}
                onChange={(e) => setPhone(formatPhoneMask(e.target.value))}
                className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] pl-10 pr-4 py-3 text-sm font-medium text-[#0f1f38] focus:border-[#012d63] focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#5a6577] mb-1.5">
              Etapa inicial
            </label>
            <select
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] px-3.5 py-3 text-sm font-medium text-[#0f1f38] focus:border-[#012d63] focus:bg-white focus:outline-none"
            >
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#5a6577] mb-2">
              Tags de interesse
            </label>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const selected = selectedTags.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                      selected
                        ? 'bg-[#012d63] text-white border-[#012d63] shadow-xs'
                        : 'bg-[#f6f7f9] text-[#5a6577] border-[#e5e9f0] hover:border-[#012d63]/40'
                    }`}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hasWhatsapp}
              onChange={(e) => setHasWhatsapp(e.target.checked)}
              className="h-4 w-4 rounded border-[#cbd5e1] accent-[#012d63]"
            />
            <span className="text-sm text-[#5a6577]">Número possui WhatsApp ativo</span>
          </label>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-medium text-red-700">
              {error}
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
              type="submit"
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#eb5b29] hover:bg-[#d44d1f] text-white py-3 text-sm font-semibold shadow-md shadow-[#eb5b29]/25 disabled:opacity-60 cursor-pointer"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar Lead
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
