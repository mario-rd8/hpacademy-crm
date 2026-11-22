import { useMemo, useState, type DragEvent } from 'react';
import { CheckSquare, Plus, Search, Send, X } from 'lucide-react';
import type {
  EnrollmentStatus,
  Lead,
  QuickFilter,
  Stage,
  Tag,
} from '../types/database.types';
import { getDaysInactive, onlyDigits } from '../utils/phone';
import { LeadCard } from './LeadCard';

interface KanbanViewProps {
  stages: Stage[];
  leads: Lead[];
  tags: Tag[];
  selectedLeadIds: string[];
  onToggleSelectLead: (leadId: string) => void;
  onSelectMultipleLeads: (leadIds: string[]) => void;
  onClearSelection: () => void;
  onOpenLead: (lead: Lead) => void;
  onRequestMove: (lead: Lead, targetStageId: string) => void;
  onToggleEnrollment: (leadId: string, nextStatus: EnrollmentStatus) => void;
  onOpenBulkSend: () => void;
  onOpenNewLead: (stageId?: string) => void;
}

export function KanbanView({
  stages,
  leads,
  tags,
  selectedLeadIds,
  onToggleSelectLead,
  onSelectMultipleLeads,
  onClearSelection,
  onOpenLead,
  onRequestMove,
  onToggleEnrollment,
  onOpenBulkSend,
  onOpenNewLead,
}: KanbanViewProps) {
  const [search, setSearch] = useState('');
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [mobileStageId, setMobileStageId] = useState<string>('');
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);

  const activeMobileStageId =
    mobileStageId && stages.some((s) => s.id === mobileStageId)
      ? mobileStageId
      : stages[0]?.id || '';

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = onlyDigits(search);
    const now = new Date();

    return leads.filter((lead) => {
      if (q) {
        const matchesName = lead.name.toLowerCase().includes(q);
        const matchesPhone = qDigits.length > 0 && lead.phone.includes(qDigits);
        if (!matchesName && !matchesPhone) return false;
      }

      if (selectedTagId && !lead.tags.some((t) => t.id === selectedTagId)) {
        return false;
      }

      if (quickFilter === 'today_tasks') {
        return lead.tasks.some((t) => {
          if (t.completed) return false;
          const d = new Date(t.due_at);
          return (
            d.getFullYear() === now.getFullYear() &&
            d.getMonth() === now.getMonth() &&
            d.getDate() === now.getDate()
          );
        });
      }

      if (quickFilter === 'overdue') {
        return lead.tasks.some((t) => !t.completed && new Date(t.due_at).getTime() < now.getTime());
      }

      if (quickFilter === 'stale') {
        const stage = stages.find((s) => s.id === lead.stage_id);
        const isClosed =
          stage?.slug === 'ganho' ||
          stage?.slug === 'perdido' ||
          stage?.name.toLowerCase() === 'ganho' ||
          stage?.name.toLowerCase() === 'perdido';
        return !isClosed && getDaysInactive(lead.last_activity_at) >= 2;
      }

      return true;
    });
  }, [leads, search, selectedTagId, quickFilter, stages]);

  const leadsByStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const stage of stages) {
      map.set(stage.id, []);
    }
    for (const lead of filteredLeads) {
      const bucket = map.get(lead.stage_id);
      if (bucket) bucket.push(lead);
    }
    return map;
  }, [stages, filteredLeads]);

  const quickFilters: { id: QuickFilter; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'today_tasks', label: 'Tarefas de hoje' },
    { id: 'overdue', label: 'Atrasados' },
    { id: 'stale', label: 'Parados (+2 dias)' },
  ];

  function handleDrop(e: DragEvent<HTMLDivElement>, targetStageId: string) {
    e.preventDefault();
    setDragOverStageId(null);
    const leadId = e.dataTransfer.getData('text/plain');
    const lead = leads.find((l) => l.id === leadId);
    if (lead && lead.stage_id !== targetStageId) {
      onRequestMove(lead, targetStageId);
    }
  }

  return (
    <div className="flex flex-col h-full pb-24 md:pb-8">
      {/* Barra de Filtros */}
      <section className="bg-white border-b border-[#e5e9f0] px-4 sm:px-6 py-3.5 space-y-3">
        <div className="max-w-[1600px] mx-auto space-y-3">
          {/* Busca + Filtros rápidos */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="h-4 w-4 text-[#8a94a6] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou telefone..."
                className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] pl-10 pr-4 py-2.5 text-sm font-medium text-[#0f1f38] placeholder:text-[#8a94a6] focus:border-[#012d63] focus:bg-white focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
              {quickFilters.map((f) => {
                const active = quickFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setQuickFilter(f.id)}
                    className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      active
                        ? 'bg-[#012d63] text-white shadow-xs'
                        : 'bg-[#f6f7f9] text-[#5a6577] hover:bg-[#eef1f5]'
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tags + Selecionar todos filtrados */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setSelectedTagId(null)}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                  selectedTagId === null
                    ? 'bg-[#012d63]/10 text-[#012d63] border-[#012d63]/30'
                    : 'bg-white text-[#5a6577] border-[#e5e9f0]'
                }`}
              >
                Todas as tags
              </button>
              {tags.map((tag) => {
                const active = selectedTagId === tag.id;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => setSelectedTagId(active ? null : tag.id)}
                    className={`shrink-0 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border transition-all cursor-pointer ${
                      active
                        ? 'text-white border-transparent shadow-xs'
                        : 'bg-white text-[#5a6577] border-[#e5e9f0] hover:border-[#012d63]/40'
                    }`}
                    style={active ? { backgroundColor: tag.color || '#012d63' } : undefined}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>

            {filteredLeads.length > 0 && (
              <button
                type="button"
                onClick={() => onSelectMultipleLeads(filteredLeads.map((l) => l.id))}
                className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-[#012d63] hover:text-[#eb5b29] transition-colors cursor-pointer"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Selecionar filtrados</span> ({filteredLeads.length})
              </button>
            )}
          </div>
        </div>
      </section>

      {/* MOBILE: Abas horizontais das colunas (sem arrastar tela lateralmente) */}
      <div className="md:hidden sticky top-16 z-20 bg-white/95 backdrop-blur-md border-b border-[#e5e9f0] px-3 py-2">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {stages.map((stage) => {
            const count = leadsByStage.get(stage.id)?.length || 0;
            const active = stage.id === activeMobileStageId;
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => setMobileStageId(stage.id)}
                className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  active
                    ? 'bg-[#012d63] text-white shadow-sm'
                    : 'bg-[#f6f7f9] text-[#5a6577]'
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: active ? '#eb5b29' : stage.color }}
                />
                {stage.name}
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                    active ? 'bg-white/20 text-white' : 'bg-white text-[#5a6577]'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* MOBILE: Lista de cards da coluna ativa */}
      <div className="md:hidden px-4 py-4 space-y-3">
        {stages
          .filter((s) => s.id === activeMobileStageId)
          .map((stage) => {
            const stageLeads = leadsByStage.get(stage.id) || [];
            if (stageLeads.length === 0) {
              return (
                <div
                  key={stage.id}
                  className="rounded-2xl border border-dashed border-[#cbd5e1] bg-white/60 p-8 text-center"
                >
                  <p className="text-sm font-semibold text-[#5a6577]">
                    Nenhum lead em {stage.name}
                  </p>
                  <button
                    type="button"
                    onClick={() => onOpenNewLead(stage.id)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#012d63] text-white px-4 py-2 text-xs font-semibold"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Adicionar lead aqui
                  </button>
                </div>
              );
            }
            return stageLeads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                stage={stage}
                stages={stages}
                selected={selectedLeadIds.includes(lead.id)}
                onToggleSelect={onToggleSelectLead}
                onOpen={onOpenLead}
                onRequestMove={onRequestMove}
                onToggleEnrollment={onToggleEnrollment}
              />
            ));
          })}
      </div>

      {/* DESKTOP: Colunas lado a lado com Drag-and-Drop */}
      <div className="hidden md:block flex-1 overflow-x-auto px-6 py-5">
        <div className="max-w-[1600px] mx-auto flex gap-4 items-start min-h-[calc(100vh-230px)]">
          {stages.map((stage) => {
            const stageLeads = leadsByStage.get(stage.id) || [];
            const isOver = dragOverStageId === stage.id;

            return (
              <div
                key={stage.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverStageId(stage.id);
                }}
                onDragLeave={() => setDragOverStageId(null)}
                onDrop={(e) => handleDrop(e, stage.id)}
                className={`w-[320px] shrink-0 rounded-2xl p-3 transition-colors border ${
                  isOver
                    ? 'bg-[#012d63]/6 border-[#012d63] border-dashed'
                    : 'bg-[#eef1f5]/75 border-[#e5e9f0]'
                }`}
              >
                {/* Cabeçalho da coluna */}
                <div className="flex items-center justify-between px-1.5 pb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: stage.color }}
                    />
                    <h2 className="text-sm font-bold text-[#012d63] truncate">{stage.name}</h2>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-[#5a6577] border border-[#e5e9f0]">
                      {stageLeads.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenNewLead(stage.id)}
                    title={`Adicionar lead em ${stage.name}`}
                    className="p-1.5 rounded-lg text-[#5a6577] hover:text-[#012d63] hover:bg-white transition-colors cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                {/* Cards */}
                <div className="space-y-2.5">
                  {stageLeads.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#cbd5e1] py-8 text-center text-xs text-[#8a94a6]">
                      Sem leads nesta etapa
                    </div>
                  ) : (
                    stageLeads.map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        stage={stage}
                        stages={stages}
                        selected={selectedLeadIds.includes(lead.id)}
                        onToggleSelect={onToggleSelectLead}
                        onOpen={onOpenLead}
                        onRequestMove={onRequestMove}
                        onToggleEnrollment={onToggleEnrollment}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Barra flutuante de ação em massa */}
      {selectedLeadIds.length > 0 && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-[78px] md:bottom-6 z-40 w-[calc(100%-2rem)] max-w-md rounded-2xl bg-[#012d63] text-white px-4 py-3 shadow-2xl shadow-[#012d63]/40 flex items-center justify-between gap-3 animate-sheet-up">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#eb5b29] text-xs font-bold">
              {selectedLeadIds.length}
            </span>
            <span className="text-xs sm:text-sm font-semibold">
              {selectedLeadIds.length === 1 ? 'lead selecionado' : 'leads selecionados'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenBulkSend}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#eb5b29] hover:bg-[#d44d1f] px-3.5 py-2 text-xs font-bold text-white shadow-sm cursor-pointer"
            >
              <Send className="h-3.5 w-3.5" />
              Disparar Mensagem
            </button>
            <button
              type="button"
              onClick={onClearSelection}
              title="Limpar seleção"
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
