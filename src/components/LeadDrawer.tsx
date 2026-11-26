import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CalendarPlus,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  FileText,
  Globe,
  Loader2,
  MessageCircle,
  MessageSquare,
  Paperclip,
  PhoneOff,
  Save,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { crmDb, supabase } from '../services/supabaseClient';
import { sendSingleMessage } from '../services/webhookService';
import type {
  EnrollmentStatus,
  Lead,
  LeadNote,
  MediaTemplate,
  MessageLog,
  MessageStatus,
  Stage,
  Tag,
  Task,
} from '../types/database.types';
import {
  applyTemplateVariables,
  formatDateTimeBr,
  formatPhoneMask,
  isValidBrPhone,
} from '../utils/phone';

interface LeadDrawerProps {
  lead: Lead;
  stages: Stage[];
  tags: Tag[];
  templates: MediaTemplate[];
  onClose: () => void;
  onOpenChat: (lead: Lead) => void;
  onUpdateLead: (
    leadId: string,
    patch: Partial<{
      name: string;
      phone: string;
      stage_id: string;
      enrollment_status: EnrollmentStatus;
      has_whatsapp: boolean;
      is_returning: boolean;
    }>
  ) => Promise<void>;
  onRequestMove: (lead: Lead, targetStageId: string) => void;
  onToggleTag: (leadId: string, tagId: string, hasTag: boolean) => Promise<void>;
  onDeleteLead: (leadId: string) => Promise<void>;
  onRefreshBoard: () => Promise<void>;
}

const STATUS_BADGE: Record<MessageStatus, { label: string; className: string }> = {
  pending: { label: 'Enviando', className: 'bg-slate-100 text-slate-600' },
  sent: { label: 'Enviado', className: 'bg-sky-50 text-sky-700' },
  delivered: { label: 'Entregue', className: 'bg-emerald-50 text-emerald-700' },
  read: { label: 'Lido', className: 'bg-emerald-100 text-emerald-800' },
  error: { label: 'Erro', className: 'bg-red-50 text-red-700' },
};

export function LeadDrawer({
  lead,
  stages,
  tags,
  templates,
  onClose,
  onOpenChat,
  onUpdateLead,
  onRequestMove,
  onToggleTag,
  onDeleteLead,
  onRefreshBoard,
}: LeadDrawerProps) {
  const { user, displayName } = useAuth();

  // Edição do lead
  const [name, setName] = useState(lead.name);
  const [phone, setPhone] = useState(formatPhoneMask(lead.phone));
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);

  // Abas internas da gaveta (melhor UX no mobile com uma mão)
  const [section, setSection] = useState<'dispatch' | 'notes' | 'tasks'>('dispatch');

  // Disparo Evolution API
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);
  const [messageLogs, setMessageLogs] = useState<MessageLog[]>([]);

  // Anotações
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Tarefas
  const [tasks, setTasks] = useState<Task[]>(lead.tasks);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDue, setNewTaskDue] = useState(() => {
    const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [savingTask, setSavingTask] = useState(false);

  useEffect(() => {
    setName(lead.name);
    setPhone(formatPhoneMask(lead.phone));
    setTasks(lead.tasks);
  }, [lead]);

  const fetchDetails = useCallback(async () => {
    const [notesRes, logsRes, tasksRes] = await Promise.all([
      crmDb()
        .from('lead_notes')
        .select('*')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false }),
      crmDb()
        .from('message_logs')
        .select('*')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(15),
      crmDb()
        .from('tasks')
        .select('*')
        .eq('lead_id', lead.id)
        .order('completed', { ascending: true })
        .order('due_at', { ascending: true }),
    ]);

    if (notesRes.data) setNotes(notesRes.data as LeadNote[]);
    if (logsRes.data) setMessageLogs(logsRes.data as MessageLog[]);
    if (tasksRes.data) setTasks(tasksRes.data as Task[]);
  }, [lead.id]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  // Realtime para status de disparo (crm.message_logs), notas e tarefas deste lead
  useEffect(() => {
    const channel = supabase
      .channel(`lead-drawer-${lead.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'crm', table: 'message_logs', filter: `lead_id=eq.${lead.id}` },
        () => fetchDetails()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'crm', table: 'lead_notes', filter: `lead_id=eq.${lead.id}` },
        () => fetchDetails()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'crm', table: 'tasks', filter: `lead_id=eq.${lead.id}` },
        () => fetchDetails()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [lead.id, fetchDetails]);

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) || null;
  const rawMessage = selectedTemplate ? selectedTemplate.body : customMessage;
  const previewMessage = applyTemplateVariables(rawMessage, name || lead.name);

  const currentStage = stages.find((s) => s.id === lead.stage_id);
  const isWonStage =
    currentStage?.slug === 'ganho' || currentStage?.name.toLowerCase() === 'ganho';

  const hasInfoChanges = name.trim() !== lead.name || phone !== formatPhoneMask(lead.phone);

  async function handleSaveInfo() {
    setInfoError(null);
    if (!name.trim()) {
      setInfoError('Nome não pode ficar vazio.');
      return;
    }
    if (!isValidBrPhone(phone)) {
      setInfoError('Telefone inválido.');
      return;
    }
    setSavingInfo(true);
    try {
      await onUpdateLead(lead.id, { name: name.trim(), phone });
    } catch (err) {
      setInfoError(err instanceof Error ? err.message : 'Erro ao atualizar lead.');
    } finally {
      setSavingInfo(false);
    }
  }

  async function handleSendEvolution() {
    setMsgError(null);
    if (!lead.has_whatsapp) {
      setMsgError('Este lead está marcado como "Sem WhatsApp".');
      return;
    }
    if (!previewMessage.trim() && !selectedTemplate?.file_url) {
      setMsgError('Selecione um material ou escreva uma mensagem.');
      return;
    }

    setSendingMsg(true);
    try {
      await sendSingleMessage({
        lead,
        messageBody: previewMessage.trim(),
        templateId: selectedTemplate?.id ?? null,
        mediaUrl: selectedTemplate?.file_url ?? null,
        fileName: selectedTemplate?.file_name ?? null,
        fileType: selectedTemplate?.file_type ?? null,
        sentBy: displayName,
      });
      setCustomMessage('');
      await fetchDetails();
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : 'Erro ao disparar mensagem.');
      await fetchDetails();
    } finally {
      setSendingMsg(false);
    }
  }

  async function handleAddNote(e: FormEvent) {
    e.preventDefault();
    if (!newNote.trim()) return;
    setSavingNote(true);
    try {
      const { error } = await crmDb().from('lead_notes').insert({
        lead_id: lead.id,
        author_id: user?.id ?? null,
        author_name: displayName,
        content: newNote.trim(),
      });
      if (error) throw new Error(error.message);
      setNewNote('');
      await Promise.all([fetchDetails(), onRefreshBoard()]);
    } finally {
      setSavingNote(false);
    }
  }

  async function handleAddTask(e: FormEvent) {
    e.preventDefault();
    if (!newTaskTitle.trim() || !newTaskDue) return;
    setSavingTask(true);
    try {
      const { error } = await crmDb().from('tasks').insert({
        lead_id: lead.id,
        title: newTaskTitle.trim(),
        due_at: new Date(newTaskDue).toISOString(),
        created_by: displayName,
      });
      if (error) throw new Error(error.message);
      setNewTaskTitle('');
      await Promise.all([fetchDetails(), onRefreshBoard()]);
    } finally {
      setSavingTask(false);
    }
  }

  async function handleToggleTask(task: Task) {
    const nextCompleted = !task.completed;
    await crmDb()
      .from('tasks')
      .update({
        completed: nextCompleted,
        completed_at: nextCompleted ? new Date().toISOString() : null,
      })
      .eq('id', task.id);
    await Promise.all([fetchDetails(), onRefreshBoard()]);
  }

  async function handleDelete() {
    if (!window.confirm(`Excluir o lead "${lead.name}" permanentemente?`)) return;
    await onDeleteLead(lead.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end bg-[#012d63]/45 backdrop-blur-xs">
      <div className="fixed inset-0" onClick={onClose} />

      <aside className="relative z-10 w-full md:w-[540px] h-[94dvh] md:h-dvh rounded-t-3xl md:rounded-none bg-white shadow-2xl flex flex-col animate-sheet-up animate-drawer-desktop overflow-hidden">
        {/* Handle mobile */}
        <div className="md:hidden flex justify-center pt-2.5 pb-1 shrink-0">
          <div className="h-1.5 w-12 rounded-full bg-[#cbd5e1]" />
        </div>

        {/* Cabeçalho da gaveta */}
        <div className="px-5 py-3.5 border-b border-[#e5e9f0] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <select
              value={lead.stage_id}
              onChange={(e) => onRequestMove(lead, e.target.value)}
              className="rounded-xl bg-[#012d63] text-white text-xs font-bold px-3 py-2 focus:outline-none cursor-pointer"
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id} className="text-[#0f1f38] bg-white">
                  {s.name}
                </option>
              ))}
            </select>

            {lead.is_returning && (
              <button
                type="button"
                title="Clique para limpar o selo de novo interesse"
                onClick={() => onUpdateLead(lead.id, { is_returning: false })}
                className="inline-flex items-center gap-1 rounded-full bg-[#eb5b29]/12 text-[#eb5b29] px-2.5 py-1 text-[11px] font-bold cursor-pointer"
              >
                <Sparkles className="h-3 w-3" />
                Novo interesse
              </button>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleDelete}
              title="Excluir lead"
              className="p-2 rounded-xl text-[#8a94a6] hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-[#8a94a6] hover:text-[#012d63] hover:bg-[#f6f7f9] transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Conteúdo rolável */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Dados básicos + edição rápida */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8a94a6] mb-1">
                  Nome
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] px-3 py-2 text-sm font-bold text-[#0f1f38] focus:border-[#012d63] focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8a94a6] mb-1">
                  Telefone
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneMask(e.target.value))}
                  className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] px-3 py-2 text-sm font-semibold text-[#0f1f38] tabular-nums focus:border-[#012d63] focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            {hasInfoChanges && (
              <button
                type="button"
                disabled={savingInfo}
                onClick={handleSaveInfo}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#012d63] text-white px-3.5 py-2 text-xs font-semibold cursor-pointer"
              >
                {savingInfo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Salvar alterações
              </button>
            )}
            {infoError && <p className="text-xs font-medium text-red-600">{infoError}</p>}

            {/* Flags rápidas: WhatsApp, Origem e Matriculado */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onUpdateLead(lead.id, { has_whatsapp: !lead.has_whatsapp })}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors cursor-pointer ${
                  lead.has_whatsapp
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                {lead.has_whatsapp ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Com WhatsApp
                  </>
                ) : (
                  <>
                    <PhoneOff className="h-3.5 w-3.5" /> Sem WhatsApp
                  </>
                )}
              </button>

              <span
                title={`Origem: ${lead.source || 'manual'}`}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border border-[#e5e9f0] bg-[#f6f7f9] text-[#5a6577] max-w-full"
              >
                <Globe className="h-3.5 w-3.5 shrink-0 text-[#012d63]" />
                <span className="truncate">{lead.source || 'manual'}</span>
              </span>

              {isWonStage && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdateLead(lead.id, {
                      enrollment_status:
                        lead.enrollment_status === 'matriculado' ? 'pendente' : 'matriculado',
                    })
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold border transition-colors cursor-pointer ${
                    lead.enrollment_status === 'matriculado'
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}
                >
                  {lead.enrollment_status === 'matriculado' ? 'Matriculado' : 'Matrícula Pendente'}
                </button>
              )}
            </div>

            {/* Tags */}
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-[#8a94a6] mb-1.5">
                Tags
              </span>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const active = lead.tags.some((t) => t.id === tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => onToggleTag(lead.id, tag.id, active)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border transition-all cursor-pointer ${
                        active
                          ? 'text-white border-transparent'
                          : 'bg-[#f6f7f9] text-[#5a6577] border-[#e5e9f0]'
                      }`}
                      style={active ? { backgroundColor: tag.color || '#012d63' } : undefined}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Seletor de seção interna */}
          <div className="grid grid-cols-3 gap-1 bg-[#f6f7f9] p-1 rounded-xl border border-[#e5e9f0]">
            <button
              type="button"
              onClick={() => setSection('dispatch')}
              className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                section === 'dispatch' ? 'bg-white text-[#012d63] shadow-xs' : 'text-[#5a6577]'
              }`}
            >
              Disparo ({messageLogs.length})
            </button>
            <button
              type="button"
              onClick={() => setSection('notes')}
              className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                section === 'notes' ? 'bg-white text-[#012d63] shadow-xs' : 'text-[#5a6577]'
              }`}
            >
              Notas ({notes.length})
            </button>
            <button
              type="button"
              onClick={() => setSection('tasks')}
              className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                section === 'tasks' ? 'bg-white text-[#012d63] shadow-xs' : 'text-[#5a6577]'
              }`}
            >
              Tarefas ({tasks.filter((t) => !t.completed).length})
            </button>
          </div>

          {/* SEÇÃO 1: Disparo Evolution API */}
          {section === 'dispatch' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[#e5e9f0] bg-[#f6f7f9] p-4 space-y-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#5a6577] mb-1.5">
                    Material da Biblioteca
                  </label>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => setSelectedTemplateId(e.target.value)}
                    className="w-full rounded-xl border border-[#e5e9f0] bg-white px-3 py-2.5 text-sm font-medium text-[#0f1f38] focus:border-[#012d63] focus:outline-none"
                  >
                    <option value="">Texto livre (sem anexo)</option>
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.title} {tpl.file_name ? `· ${tpl.file_name}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {!selectedTemplate && (
                  <textarea
                    rows={3}
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    placeholder="Olá {{nome}}, tudo bem? Aqui é da HP Academy..."
                    className="w-full rounded-xl border border-[#e5e9f0] bg-white p-3 text-sm text-[#0f1f38] focus:border-[#012d63] focus:outline-none resize-none"
                  />
                )}

                {(previewMessage || selectedTemplate?.file_name) && (
                  <div className="rounded-xl bg-white border border-[#e5e9f0] p-3 space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[#8a94a6]">
                      <span>Preview preenchido</span>
                      {selectedTemplate?.file_name && (
                        <span className="inline-flex items-center gap-1 text-[#012d63]">
                          <Paperclip className="h-3 w-3" />
                          {selectedTemplate.file_name}
                        </span>
                      )}
                    </div>
                    {selectedTemplate?.file_url && selectedTemplate.file_type === 'application/pdf' && (
                      <div className="inline-flex items-center gap-1.5 rounded-lg bg-[#f6f7f9] px-2.5 py-1.5 text-xs font-semibold text-[#012d63]">
                        <FileText className="h-3.5 w-3.5 text-[#eb5b29]" />
                        {selectedTemplate.file_name}
                      </div>
                    )}
                    <p className="text-xs text-[#0f1f38] whitespace-pre-wrap leading-relaxed">
                      {previewMessage}
                    </p>
                  </div>
                )}

                {msgError && (
                  <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs font-medium text-red-700 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{msgError}</span>
                  </div>
                )}

                <button
                  type="button"
                  disabled={sendingMsg}
                  onClick={handleSendEvolution}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#eb5b29] hover:bg-[#d44d1f] text-white py-3 text-sm font-bold shadow-sm shadow-[#eb5b29]/25 disabled:opacity-60 cursor-pointer"
                >
                  {sendingMsg ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Disparar via Evolution API
                    </>
                  )}
                </button>
              </div>

              {/* Histórico de disparos com Realtime */}
              <div className="space-y-2">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#8a94a6]">
                  Histórico de disparos (tempo real)
                </h4>
                {messageLogs.length === 0 ? (
                  <p className="text-xs text-[#8a94a6] py-3 text-center bg-[#f6f7f9] rounded-xl">
                    Nenhum disparo registrado para este lead.
                  </p>
                ) : (
                  messageLogs.map((log) => {
                    const badge = STATUS_BADGE[log.status];
                    return (
                      <div
                        key={log.id}
                        className="rounded-xl border border-[#e5e9f0] bg-white p-3 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-[#5a6577]">
                            {log.sent_by || 'Equipe'} · {formatDateTimeBr(log.created_at)}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.className}`}
                          >
                            {log.status === 'read' || log.status === 'delivered' ? (
                              <CheckCheck className="h-3 w-3" />
                            ) : log.status === 'pending' ? (
                              <Clock className="h-3 w-3" />
                            ) : null}
                            {badge.label}
                          </span>
                        </div>
                        {log.message_body && (
                          <p className="text-xs text-[#0f1f38] whitespace-pre-wrap line-clamp-3">
                            {log.message_body}
                          </p>
                        )}
                        {log.status === 'error' && log.error_detail && (
                          <p className="text-[11px] font-medium text-red-600 bg-red-50 rounded-lg px-2.5 py-1.5">
                            {log.error_detail}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* SEÇÃO 2: Timeline de Anotações */}
          {section === 'notes' && (
            <div className="space-y-4">
              <form onSubmit={handleAddNote} className="space-y-2">
                <textarea
                  rows={3}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Registre o andamento da conversa, objeções ou próximos passos..."
                  className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] p-3 text-sm text-[#0f1f38] focus:border-[#012d63] focus:bg-white focus:outline-none resize-none"
                />
                <button
                  type="submit"
                  disabled={savingNote || !newNote.trim()}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#012d63] hover:bg-[#001f47] text-white py-2.5 text-xs font-bold disabled:opacity-50 cursor-pointer"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  {savingNote ? 'Salvando...' : 'Adicionar anotação'}
                </button>
              </form>

              <div className="space-y-2.5">
                {notes.length === 0 ? (
                  <p className="text-xs text-[#8a94a6] py-6 text-center bg-[#f6f7f9] rounded-xl">
                    Nenhuma anotação registrada ainda.
                  </p>
                ) : (
                  notes.map((note) => (
                    <div
                      key={note.id}
                      className="rounded-xl border border-[#e5e9f0] bg-white p-3.5 space-y-1"
                    >
                      <div className="flex items-center justify-between text-[11px] text-[#8a94a6]">
                        <span className="font-bold text-[#012d63]">{note.author_name}</span>
                        <span>{formatDateTimeBr(note.created_at)}</span>
                      </div>
                      <p className="text-sm text-[#0f1f38] whitespace-pre-wrap leading-relaxed">
                        {note.content}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* SEÇÃO 3: Tarefas e Follow-ups */}
          {section === 'tasks' && (
            <div className="space-y-4">
              <form
                onSubmit={handleAddTask}
                className="rounded-2xl border border-[#e5e9f0] bg-[#f6f7f9] p-3.5 space-y-2.5"
              >
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Ex: Ligar para confirmar visita / enviar boleto"
                  className="w-full rounded-xl border border-[#e5e9f0] bg-white px-3 py-2.5 text-sm text-[#0f1f38] focus:border-[#012d63] focus:outline-none"
                />
                <div className="flex gap-2">
                  <input
                    type="datetime-local"
                    value={newTaskDue}
                    onChange={(e) => setNewTaskDue(e.target.value)}
                    className="flex-1 rounded-xl border border-[#e5e9f0] bg-white px-3 py-2 text-xs font-medium text-[#0f1f38] focus:border-[#012d63] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={savingTask || !newTaskTitle.trim()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#012d63] text-white px-4 py-2 text-xs font-bold disabled:opacity-50 cursor-pointer"
                  >
                    <CalendarPlus className="h-3.5 w-3.5" />
                    Criar
                  </button>
                </div>
              </form>

              <div className="space-y-2">
                {tasks.length === 0 ? (
                  <p className="text-xs text-[#8a94a6] py-6 text-center bg-[#f6f7f9] rounded-xl">
                    Nenhuma tarefa agendada para este lead.
                  </p>
                ) : (
                  tasks.map((task) => {
                    const isOverdue = !task.completed && new Date(task.due_at).getTime() < Date.now();
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => handleToggleTask(task)}
                        className={`w-full flex items-start gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer ${
                          task.completed
                            ? 'bg-[#f6f7f9] border-[#e5e9f0] opacity-65'
                            : isOverdue
                              ? 'bg-rose-50/50 border-rose-200'
                              : 'bg-white border-[#e5e9f0]'
                        }`}
                      >
                        <span
                          className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border flex items-center justify-center ${
                            task.completed
                              ? 'bg-emerald-500 border-emerald-500 text-white'
                              : 'border-[#cbd5e1] bg-white'
                          }`}
                        >
                          {task.completed && <Check className="h-3 w-3 stroke-[3]" />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm font-semibold ${
                              task.completed ? 'line-through text-[#8a94a6]' : 'text-[#0f1f38]'
                            }`}
                          >
                            {task.title}
                          </p>
                          <p
                            className={`text-[11px] font-medium mt-0.5 ${
                              isOverdue ? 'text-rose-600 font-bold' : 'text-[#8a94a6]'
                            }`}
                          >
                            {formatDateTimeBr(task.due_at)}
                            {isOverdue ? ' · Atrasada' : ''}
                          </p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Rodapé fixo para uso com uma mão: Botão Conversar (abre o Chat integrado) */}
        <div className="p-4 border-t border-[#e5e9f0] bg-white shrink-0 safe-pb">
          <button
            type="button"
            onClick={() => onOpenChat(lead)}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-[#012d63] hover:bg-[#001f47] active:scale-[0.99] text-white font-bold py-3.5 text-sm shadow-lg shadow-[#012d63]/20 transition-all cursor-pointer"
          >
            <MessageCircle className="h-4 w-4 text-[#eb5b29]" />
            Conversar
          </button>
        </div>
      </aside>
    </div>
  );
}
