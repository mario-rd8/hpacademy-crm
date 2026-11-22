import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { LossReason, Stage, Tag } from '../types/database.types';

interface SettingsViewProps {
  stages: Stage[];
  tags: Tag[];
  lossReasons: LossReason[];
  onCreateStage: (name: string, color: string) => Promise<void>;
  onUpdateStage: (stageId: string, patch: Partial<Pick<Stage, 'name' | 'color'>>) => Promise<void>;
  onReorderStages: (ordered: Stage[]) => Promise<void>;
  onDeleteStage: (stageId: string) => Promise<void>;
  onCreateTag: (name: string, color: string) => Promise<void>;
  onDeleteTag: (tagId: string) => Promise<void>;
  onCreateLossReason: (label: string) => Promise<void>;
  onDeleteLossReason: (reasonId: string) => Promise<void>;
}

const PRESET_COLORS = ['#012d63', '#eb5b29', '#10b981', '#ef4444', '#6366f1', '#0ea5e9', '#f59e0b'];

export function SettingsView({
  stages,
  tags,
  lossReasons,
  onCreateStage,
  onUpdateStage,
  onReorderStages,
  onDeleteStage,
  onCreateTag,
  onDeleteTag,
  onCreateLossReason,
  onDeleteLossReason,
}: SettingsViewProps) {
  const [newStageName, setNewStageName] = useState('');
  const [newStageColor, setNewStageColor] = useState('#012d63');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#012d63');
  const [newReason, setNewReason] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleAddStage(e: FormEvent) {
    e.preventDefault();
    if (!newStageName.trim()) return;
    setFeedback(null);
    try {
      await onCreateStage(newStageName, newStageColor);
      setNewStageName('');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erro ao criar coluna.');
    }
  }

  async function moveStage(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= stages.length) return;
    const clone = [...stages];
    const [item] = clone.splice(index, 1);
    clone.splice(target, 0, item);
    await onReorderStages(clone);
  }

  async function handleAddTag(e: FormEvent) {
    e.preventDefault();
    if (!newTagName.trim()) return;
    setFeedback(null);
    try {
      await onCreateTag(newTagName, newTagColor);
      setNewTagName('');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erro ao criar tag.');
    }
  }

  async function handleAddReason(e: FormEvent) {
    e.preventDefault();
    if (!newReason.trim()) return;
    setFeedback(null);
    try {
      await onCreateLossReason(newReason);
      setNewReason('');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erro ao criar motivo.');
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 pb-28 md:pb-12 space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-[#012d63]">Configurações</h1>
        <p className="text-xs sm:text-sm text-[#5a6577] mt-0.5">
          Personalize colunas do Kanban, tags de classificação e motivos de perda.
        </p>
      </div>

      {feedback && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs font-medium text-red-700">
          {feedback}
        </div>
      )}

      {/* 1. Colunas do Kanban */}
      <section className="rounded-2xl bg-white border border-[#e5e9f0] p-5 space-y-4">
        <h2 className="text-base font-bold text-[#012d63]">Colunas do Kanban</h2>

        <div className="space-y-2">
          {stages.map((stage, idx) => (
            <div
              key={stage.id}
              className="flex items-center gap-2.5 rounded-xl bg-[#f6f7f9] border border-[#e5e9f0] px-3 py-2.5"
            >
              <input
                type="color"
                value={stage.color}
                onChange={(e) => onUpdateStage(stage.id, { color: e.target.value })}
                className="h-6 w-6 rounded cursor-pointer border-0 bg-transparent shrink-0"
              />
              <input
                type="text"
                defaultValue={stage.name}
                onBlur={(e) => {
                  const val = e.target.value.trim();
                  if (val && val !== stage.name) {
                    onUpdateStage(stage.id, { name: val });
                  }
                }}
                className="flex-1 bg-transparent text-sm font-semibold text-[#0f1f38] focus:bg-white focus:px-2 rounded-lg focus:outline-none"
              />

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => moveStage(idx, -1)}
                  className="p-1.5 rounded-lg text-[#5a6577] hover:bg-white disabled:opacity-30 cursor-pointer"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={idx === stages.length - 1}
                  onClick={() => moveStage(idx, 1)}
                  className="p-1.5 rounded-lg text-[#5a6577] hover:bg-white disabled:opacity-30 cursor-pointer"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                {!stage.is_system && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Excluir a coluna "${stage.name}"?`)) {
                        onDeleteStage(stage.id).catch((err) =>
                          setFeedback(
                            err instanceof Error
                              ? err.message
                              : 'Mova os leads desta coluna antes de excluí-la.'
                          )
                        );
                      }
                    }}
                    className="p-1.5 rounded-lg text-[#5a6577] hover:text-red-600 hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleAddStage} className="flex flex-col sm:flex-row gap-2 pt-2">
          <input
            type="text"
            placeholder="Nova coluna (ex: Agendou visita)"
            value={newStageName}
            onChange={(e) => setNewStageName(e.target.value)}
            className="flex-1 rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] px-3.5 py-2.5 text-sm focus:border-[#012d63] focus:bg-white focus:outline-none"
          />
          <div className="flex items-center gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNewStageColor(c)}
                className={`h-7 w-7 rounded-full cursor-pointer transition-transform ${
                  newStageColor === c ? 'scale-110 ring-2 ring-offset-2 ring-[#012d63]' : ''
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#012d63] text-white px-4 py-2.5 text-xs font-bold cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Adicionar
          </button>
        </form>
      </section>

      {/* 2. Tags */}
      <section className="rounded-2xl bg-white border border-[#e5e9f0] p-5 space-y-4">
        <h2 className="text-base font-bold text-[#012d63]">Tags</h2>

        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-2 rounded-full pl-3.5 pr-2 py-1.5 text-xs font-bold uppercase tracking-wider text-white"
              style={{ backgroundColor: tag.color || '#012d63' }}
            >
              {tag.name}
              <button
                type="button"
                onClick={() => onDeleteTag(tag.id)}
                className="p-0.5 rounded-full bg-white/20 hover:bg-white/35 cursor-pointer"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        <form onSubmit={handleAddTag} className="flex flex-col sm:flex-row gap-2 pt-1">
          <input
            type="text"
            placeholder="Nova tag (ex: medicina, bolsista)"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            className="flex-1 rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] px-3.5 py-2.5 text-sm focus:border-[#012d63] focus:bg-white focus:outline-none"
          />
          <div className="flex items-center gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNewTagColor(c)}
                className={`h-7 w-7 rounded-full cursor-pointer transition-transform ${
                  newTagColor === c ? 'scale-110 ring-2 ring-offset-2 ring-[#012d63]' : ''
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#012d63] text-white px-4 py-2.5 text-xs font-bold cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Criar Tag
          </button>
        </form>
      </section>

      {/* 3. Motivos de Perda */}
      <section className="rounded-2xl bg-white border border-[#e5e9f0] p-5 space-y-4">
        <h2 className="text-base font-bold text-[#012d63]">Motivos de Perda</h2>

        <div className="space-y-2">
          {lossReasons.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-xl bg-[#f6f7f9] border border-[#e5e9f0] px-3.5 py-2.5"
            >
              <span className="text-sm font-medium text-[#0f1f38]">{r.label}</span>
              <button
                type="button"
                onClick={() => onDeleteLossReason(r.id)}
                className="p-1.5 rounded-lg text-[#5a6577] hover:text-red-600 hover:bg-red-50 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={handleAddReason} className="flex gap-2 pt-1">
          <input
            type="text"
            placeholder="Novo motivo de perda..."
            value={newReason}
            onChange={(e) => setNewReason(e.target.value)}
            className="flex-1 rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] px-3.5 py-2.5 text-sm focus:border-[#012d63] focus:bg-white focus:outline-none"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#012d63] text-white px-4 py-2.5 text-xs font-bold cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Adicionar
          </button>
        </form>
      </section>
    </div>
  );
}
