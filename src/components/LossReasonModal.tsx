import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { Lead, LossReason } from '../types/database.types';

interface LossReasonModalProps {
  lead: Lead;
  reasons: LossReason[];
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

export function LossReasonModal({ lead, reasons, onCancel, onConfirm }: LossReasonModalProps) {
  const [selected, setSelected] = useState<string>(reasons[0]?.label || '');
  const [customReason, setCustomReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const finalReason = selected === 'Outro' && customReason.trim() ? customReason.trim() : selected;

  async function handleConfirm() {
    if (!finalReason) return;
    setSubmitting(true);
    try {
      await onConfirm(finalReason);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-[#012d63]/45 backdrop-blur-xs">
      <div className="w-full md:max-w-md rounded-t-3xl md:rounded-3xl bg-white shadow-2xl border border-[#e5e9f0] animate-sheet-up">
        <div className="md:hidden flex justify-center pt-3 pb-1">
          <div className="h-1.5 w-12 rounded-full bg-[#cbd5e1]" />
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e9f0]">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#012d63]">Motivo da perda</h2>
              <p className="text-xs text-[#5a6577] truncate max-w-[220px]">{lead.name}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-xl text-[#8a94a6] hover:text-[#012d63] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-3">
          <p className="text-xs font-medium text-[#5a6577]">
            Selecione o motivo antes de mover este lead para <strong>Perdido</strong>:
          </p>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {reasons.map((r) => {
              const active = selected === r.label;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelected(r.label)}
                  className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition-all cursor-pointer ${
                    active
                      ? 'border-red-500 bg-red-50/70 text-red-800 font-semibold'
                      : 'border-[#e5e9f0] bg-[#f6f7f9] text-[#0f1f38] hover:border-[#cbd5e1]'
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>

          {selected === 'Outro' && (
            <input
              type="text"
              placeholder="Descreva o motivo..."
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] px-3.5 py-2.5 text-sm focus:border-[#012d63] focus:bg-white focus:outline-none"
            />
          )}

          <div className="flex items-center gap-3 pt-3 safe-pb">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-xl border border-[#e5e9f0] py-3 text-sm font-semibold text-[#5a6577] hover:bg-[#f6f7f9] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!finalReason || submitting}
              onClick={handleConfirm}
              className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 text-white py-3 text-sm font-semibold disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Movendo...' : 'Confirmar perda'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
