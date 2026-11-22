import { useState, type DragEvent } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  CalendarClock,
  Check,
  Clock,
  PhoneOff,
  Sparkles,
} from 'lucide-react';
import type { EnrollmentStatus, Lead, Stage } from '../types/database.types';
import { formatPhoneMask, formatRelativeTime, getDaysInactive } from '../utils/phone';

interface LeadCardProps {
  lead: Lead;
  stage: Stage;
  stages: Stage[];
  selected: boolean;
  onToggleSelect: (leadId: string) => void;
  onOpen: (lead: Lead) => void;
  onRequestMove: (lead: Lead, targetStageId: string) => void;
  onToggleEnrollment: (leadId: string, nextStatus: EnrollmentStatus) => void;
}

export function LeadCard({
  lead,
  stage,
  stages,
  selected,
  onToggleSelect,
  onOpen,
  onRequestMove,
  onToggleEnrollment,
}: LeadCardProps) {
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  const daysInactive = getDaysInactive(lead.last_activity_at);
  const isWonStage = stage.slug === 'ganho' || stage.name.toLowerCase() === 'ganho';
  const isLostStage = stage.slug === 'perdido' || stage.name.toLowerCase() === 'perdido';

  // Cor dinâmica por tempo parado (0-1d neutro, 2d âmbar, 3+d alerta vermelho/neon)
  let inactivityBorder = 'border-l-[#cbd5e1]';
  let inactivityBadge = 'text-[#8a94a6] bg-[#f6f7f9]';
  if (!isWonStage && !isLostStage) {
    if (daysInactive >= 3) {
      inactivityBorder = 'border-l-[#ff2e55] shadow-[inset_3px_0_0_rgba(255,46,85,0.2)]';
      inactivityBadge = 'text-[#e11d48] bg-rose-50 ring-1 ring-rose-200';
    } else if (daysInactive === 2) {
      inactivityBorder = 'border-l-amber-400';
      inactivityBadge = 'text-amber-700 bg-amber-50 ring-1 ring-amber-200';
    }
  }

  const pendingTasks = lead.tasks.filter((t) => !t.completed);
  const now = Date.now();
  const hasOverdueTask = pendingTasks.some((t) => new Date(t.due_at).getTime() < now);
  const hasTodayTask = pendingTasks.some((t) => {
    const d = new Date(t.due_at);
    const today = new Date();
    return (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  });

  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData('text/plain', lead.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className={`group relative rounded-2xl bg-white border border-[#e5e9f0] border-l-4 ${inactivityBorder} p-3.5 shadow-xs hover:shadow-md transition-all ${
        selected ? 'ring-2 ring-[#eb5b29] bg-[#eb5b29]/[0.02]' : ''
      }`}
    >
      {/* Linha topo: checkbox discreto + nome + tempo parado */}
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(lead.id);
          }}
          aria-label="Selecionar lead"
          className={`mt-0.5 h-5 w-5 shrink-0 rounded-md border flex items-center justify-center transition-all cursor-pointer ${
            selected
              ? 'bg-[#eb5b29] border-[#eb5b29] text-white'
              : 'border-[#cbd5e1] bg-white text-transparent hover:border-[#012d63]'
          }`}
        >
          <Check className="h-3.5 w-3.5 stroke-[3]" />
        </button>

        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpen(lead)}>
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-bold text-[#0f1f38] leading-snug truncate">
              {lead.name}
            </h3>
            <span
              title={`Última atividade há ${formatRelativeTime(lead.last_activity_at)}`}
              className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${inactivityBadge}`}
            >
              <Clock className="h-2.5 w-2.5" />
              {formatRelativeTime(lead.last_activity_at)}
            </span>
          </div>

          <p className="text-xs font-medium text-[#5a6577] mt-0.5 tabular-nums">
            {formatPhoneMask(lead.phone)}
          </p>
        </div>
      </div>

      {/* Selos visuais */}
      {(lead.is_returning || !lead.has_whatsapp || hasOverdueTask || hasTodayTask || lead.loss_reason) && (
        <div className="flex flex-wrap gap-1.5 mt-2.5 cursor-pointer" onClick={() => onOpen(lead)}>
          {lead.is_returning && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#eb5b29]/12 text-[#eb5b29] px-2 py-0.5 text-[10px] font-bold">
              <Sparkles className="h-2.5 w-2.5" />
              Novo interesse
            </span>
          )}
          {!lead.has_whatsapp && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[10px] font-semibold">
              <PhoneOff className="h-2.5 w-2.5" />
              Sem WhatsApp
            </span>
          )}
          {hasOverdueTask && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 px-2 py-0.5 text-[10px] font-bold">
              <AlertCircle className="h-2.5 w-2.5" />
              Tarefa atrasada
            </span>
          )}
          {!hasOverdueTask && hasTodayTask && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 text-sky-700 px-2 py-0.5 text-[10px] font-bold">
              <CalendarClock className="h-2.5 w-2.5" />
              Tarefa hoje
            </span>
          )}
          {isLostStage && lead.loss_reason && (
            <span className="inline-flex items-center rounded-full bg-red-50 text-red-700 px-2 py-0.5 text-[10px] font-medium truncate max-w-full">
              {lead.loss_reason}
            </span>
          )}
        </div>
      )}

      {/* Tags */}
      {lead.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2.5 cursor-pointer" onClick={() => onOpen(lead)}>
          {lead.tags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
              style={{ backgroundColor: tag.color || '#012d63' }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {/* Rodapé: Toggle Pendente/Matriculado (se Ganho) + Botão rápido Mover etapa */}
      <div className="mt-3 pt-2.5 border-t border-[#f1f5f9] flex items-center justify-between gap-2">
        {isWonStage ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleEnrollment(
                lead.id,
                lead.enrollment_status === 'matriculado' ? 'pendente' : 'matriculado'
              );
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer ${
              lead.enrollment_status === 'matriculado'
                ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300'
                : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                lead.enrollment_status === 'matriculado' ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            {lead.enrollment_status === 'matriculado' ? 'Matriculado' : 'Pendente'}
          </button>
        ) : (
          <span className="text-[10px] font-medium uppercase tracking-wider text-[#8a94a6]">
            {lead.source || 'manual'}
          </span>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowMoveMenu((v) => !v);
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-[#f6f7f9] hover:bg-[#012d63] text-[#012d63] hover:text-white px-2.5 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer"
          >
            <ArrowRightLeft className="h-3 w-3" />
            Mover
          </button>

          {showMoveMenu && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMoveMenu(false);
                }}
              />
              <div className="absolute right-0 bottom-full mb-1.5 z-30 w-48 rounded-2xl bg-white shadow-xl border border-[#e5e9f0] py-1.5 overflow-hidden">
                <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#8a94a6]">
                  Mover para etapa
                </div>
                {stages.map((target) => {
                  const isCurrent = target.id === stage.id;
                  return (
                    <button
                      key={target.id}
                      type="button"
                      disabled={isCurrent}
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMoveMenu(false);
                        onRequestMove(lead, target.id);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold transition-colors ${
                        isCurrent
                          ? 'text-[#8a94a6] bg-[#f6f7f9] cursor-default'
                          : 'text-[#0f1f38] hover:bg-[#012d63]/6 cursor-pointer'
                      }`}
                    >
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: target.color }}
                      />
                      <span className="truncate">{target.name}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
