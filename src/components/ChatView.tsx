import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  Clock,
  Download,
  FileText,
  Image as ImageIcon,
  Kanban,
  Loader2,
  MessageCircle,
  Mic,
  Paperclip,
  Play,
  Search,
  Send,
  Square,
  Star,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { crmDb, supabase } from '../services/supabaseClient';
import {
  fetchOnDemandMediaUrl,
  markLeadMessagesRead,
  sendChatAudio,
  sendChatMessage,
  uploadChatAttachment,
} from '../services/chatService';
import type {
  ChatMessage,
  Lead,
  MediaTemplate,
  MessageStatus,
  Stage,
} from '../types/database.types';
import {
  applyTemplateVariables,
  formatPhoneMask,
  normalizeSearchText,
  onlyDigits,
} from '../utils/phone';

interface ChatViewProps {
  leads: Lead[];
  stages: Stage[];
  templates: MediaTemplate[];
  selectedLeadId: string | null;
  onSelectLead: (leadId: string | null) => void;
  onOpenLeadDrawer: (lead: Lead) => void;
  onRequestMove: (lead: Lead, targetStageId: string) => void;
}

function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatShortTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function formatDayDivider(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const isSame = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSame(d, now)) return 'Hoje';
  if (isSame(d, yesterday)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function MessageStatusIcon({ status }: { status: MessageStatus }) {
  if (status === 'pending') return <Clock className="h-3 w-3 opacity-70" />;
  if (status === 'sent') return <Check className="h-3.5 w-3.5 opacity-80" />;
  if (status === 'delivered') return <CheckCheck className="h-3.5 w-3.5 opacity-85" />;
  if (status === 'read') return <CheckCheck className="h-3.5 w-3.5 text-[#38bdf8]" />;
  return <AlertCircle className="h-3.5 w-3.5 text-rose-300" />;
}

function OnDemandMediaContent({ msg, isOutbound }: { msg: ChatMessage; isOutbound: boolean }) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(msg.media_url);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleLoad() {
    setLoading(true);
    setErr(null);
    try {
      const { objectUrl } = await fetchOnDemandMediaUrl(msg.id);
      setLoadedUrl(objectUrl);
      if (msg.message_type === 'document') {
        window.open(objectUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao carregar mídia');
    } finally {
      setLoading(false);
    }
  }

  if (msg.message_type === 'image') {
    if (loadedUrl) {
      return (
        <a href={loadedUrl} target="_blank" rel="noopener noreferrer" className="block mb-1.5">
          <img
            src={loadedUrl}
            alt={msg.media_file_name || 'Foto'}
            className="max-h-64 rounded-xl object-cover border border-black/10"
          />
        </a>
      );
    }
    return (
      <div className="mb-1.5">
        <button
          type="button"
          disabled={loading}
          onClick={handleLoad}
          className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold border transition-colors cursor-pointer ${
            isOutbound
              ? 'bg-white/12 border-white/20 text-white hover:bg-white/20'
              : 'bg-[#f6f7f9] border-[#e5e9f0] text-[#012d63] hover:bg-[#eef1f5]'
          }`}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
          {loading ? 'Carregando foto...' : 'Carregar foto'}
        </button>
        {err && <p className="text-[10px] text-rose-400 mt-1">{err}</p>}
      </div>
    );
  }

  if (msg.message_type === 'audio') {
    if (loadedUrl) {
      return (
        <div className="mb-1 flex items-center gap-2 min-w-[220px]">
          <audio controls src={loadedUrl} className="h-9 w-full max-w-[260px]" />
        </div>
      );
    }
    return (
      <div className="mb-1">
        <button
          type="button"
          disabled={loading}
          onClick={handleLoad}
          className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold border transition-colors cursor-pointer ${
            isOutbound
              ? 'bg-white/12 border-white/20 text-white hover:bg-white/20'
              : 'bg-[#f6f7f9] border-[#e5e9f0] text-[#012d63] hover:bg-[#eef1f5]'
          }`}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current" />
          )}
          <Volume2 className="h-4 w-4" />
          {loading ? 'Carregando áudio...' : 'Ouvir áudio'}
        </button>
        {err && <p className="text-[10px] text-rose-400 mt-1">{err}</p>}
      </div>
    );
  }

  if (msg.message_type === 'document' || msg.message_type === 'video') {
    return (
      <div className="mb-1.5">
        {loadedUrl ? (
          <a
            href={loadedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold border ${
              isOutbound
                ? 'bg-white/12 border-white/20 text-white'
                : 'bg-[#f6f7f9] border-[#e5e9f0] text-[#012d63]'
            }`}
          >
            <FileText className="h-4 w-4 shrink-0 text-[#eb5b29]" />
            <span className="truncate max-w-[190px]">{msg.media_file_name || 'Arquivo'}</span>
            <Download className="h-3.5 w-3.5 shrink-0 opacity-75" />
          </a>
        ) : (
          <button
            type="button"
            disabled={loading}
            onClick={handleLoad}
            className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold border transition-colors cursor-pointer ${
              isOutbound
                ? 'bg-white/12 border-white/20 text-white hover:bg-white/20'
                : 'bg-[#f6f7f9] border-[#e5e9f0] text-[#012d63] hover:bg-[#eef1f5]'
            }`}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="truncate max-w-[180px]">
              {loading ? 'Baixando...' : msg.media_file_name || 'Baixar arquivo'}
            </span>
          </button>
        )}
        {err && <p className="text-[10px] text-rose-400 mt-1">{err}</p>}
      </div>
    );
  }

  return null;
}

export function ChatView({
  leads,
  stages,
  templates,
  selectedLeadId,
  onSelectLead,
  onOpenLeadDrawer,
  onRequestMove,
}: ChatViewProps) {
  const { displayName } = useAuth();

  // Filtros da coluna esquerda
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [stageFilterId, setStageFilterId] = useState<string>('all');

  // Mensagens da conversa aberta
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Dropdown etapa no cabeçalho
  const [stageMenuOpen, setStageMenuOpen] = useState(false);

  // Seletor rápido da Biblioteca (Estrela)
  const [libraryOpen, setLibraryOpen] = useState(false);

  // Anexo normal (Clipe)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // Gravação de áudio pelo navegador
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const stageMap = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);

  const activeLead = useMemo(
    () => leads.find((l) => l.id === selectedLeadId) || null,
    [leads, selectedLeadId]
  );

  const totalUnreadChats = useMemo(
    () => leads.filter((l) => (l.unread_count || 0) > 0).length,
    [leads]
  );

  const sortedFilteredLeads = useMemo(() => {
    const q = normalizeSearchText(search);
    const qDigits = onlyDigits(search);

    return [...leads]
      .filter((l) => {
        if (unreadOnly && !(l.unread_count > 0)) return false;
        if (stageFilterId !== 'all' && l.stage_id !== stageFilterId) return false;
        if (q) {
          const byName = normalizeSearchText(l.name).includes(q);
          const byPhone = qDigits.length > 0 && l.phone.includes(qDigits);
          if (!byName && !byPhone) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const ta = new Date(a.last_message_at || a.last_activity_at).getTime();
        const tb = new Date(b.last_message_at || b.last_activity_at).getTime();
        return tb - ta;
      });
  }, [leads, search, unreadOnly, stageFilterId]);

  const loadMessages = useCallback(async (leadId: string) => {
    setLoadingMsgs(true);
    setSendError(null);
    try {
      const { data, error } = await crmDb()
        .from('chat_messages')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: true })
        .limit(200);

      if (error) throw new Error(error.message);
      setMessages((data ?? []) as ChatMessage[]);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Erro ao carregar mensagens.');
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  // Carrega mensagens e zera não lidas ao selecionar um lead
  useEffect(() => {
    if (!selectedLeadId) {
      setMessages([]);
      return;
    }
    setStageMenuOpen(false);
    setLibraryOpen(false);
    setPendingFile(null);
    loadMessages(selectedLeadId);

    const target = leads.find((l) => l.id === selectedLeadId);
    if (target && target.unread_count > 0) {
      markLeadMessagesRead(selectedLeadId).catch(() => {});
    }
  }, [selectedLeadId, loadMessages]);

  // Supabase Realtime para novas mensagens e status na conversa aberta
  useEffect(() => {
    if (!selectedLeadId) return;

    const channel = supabase
      .channel(`chat-messages-${selectedLeadId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'crm', table: 'chat_messages', filter: `lead_id=eq.${selectedLeadId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const incoming = payload.new as ChatMessage;
            setMessages((prev) =>
              prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]
            );
            if (incoming.direction === 'inbound') {
              markLeadMessagesRead(selectedLeadId).catch(() => {});
            }
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as ChatMessage;
            setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedLeadId]);

  // Scroll automático para última mensagem
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, selectedLeadId]);

  // Limpa timer de gravação ao desmontar
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
    };
  }, []);

  async function handleSendTextOrFile() {
    if (!activeLead || sending) return;
    if (!draft.trim() && !pendingFile) return;

    setSending(true);
    setSendError(null);
    try {
      let mediaUrl: string | null = null;
      let fileName: string | null = null;
      let fileType: string | null = null;

      if (pendingFile) {
        const uploaded = await uploadChatAttachment(pendingFile);
        mediaUrl = uploaded.url;
        fileName = uploaded.fileName;
        fileType = uploaded.fileType;
      }

      const saved = await sendChatMessage({
        leadId: activeLead.id,
        phone: activeLead.phone,
        text: draft.trim(),
        mediaUrl,
        fileName,
        fileType,
        sentBy: displayName,
      });

      if (saved) {
        setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]));
      }
      setDraft('');
      setPendingFile(null);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Erro ao enviar mensagem.');
    } finally {
      setSending(false);
    }
  }

  async function handleSendTemplate(tpl: MediaTemplate) {
    if (!activeLead || sending) return;
    setLibraryOpen(false);
    setSending(true);
    setSendError(null);
    try {
      const filledText = applyTemplateVariables(tpl.body, activeLead.name);
      const saved = await sendChatMessage({
        leadId: activeLead.id,
        phone: activeLead.phone,
        text: filledText,
        mediaUrl: tpl.file_url,
        fileName: tpl.file_name,
        fileType: tpl.file_type,
        templateId: tpl.id,
        sentBy: displayName,
      });
      if (saved) {
        setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]));
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Erro ao enviar material.');
    } finally {
      setSending(false);
    }
  }

  function handleFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] || null;
    e.target.value = '';
    if (!picked) return;
    setPendingFile(picked);
  }

  async function startRecording() {
    setSendError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setRecordingSeconds(0);
      recordTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setSendError('Permita o acesso ao microfone no navegador para gravar áudios.');
    }
  }

  function cancelRecording() {
    const rec = mediaRecorderRef.current;
    if (rec) {
      rec.onstop = null;
      rec.stop();
      rec.stream.getTracks().forEach((t) => t.stop());
    }
    if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    setRecording(false);
    setRecordingSeconds(0);
  }

  async function stopAndSendRecording() {
    const rec = mediaRecorderRef.current;
    if (!rec || !activeLead) return;

    if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);

    const blob = await new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        rec.stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(audioChunksRef.current, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.stop();
    });

    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    setRecording(false);
    setRecordingSeconds(0);

    if (blob.size < 200) return;

    setSending(true);
    setSendError(null);
    try {
      const saved = await sendChatAudio({
        leadId: activeLead.id,
        phone: activeLead.phone,
        audioBlob: blob,
        sentBy: displayName,
      });
      if (saved) {
        setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]));
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Erro ao enviar áudio.');
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendTextOrFile();
    }
  }

  const activeStage = activeLead ? stageMap.get(activeLead.stage_id) : null;
  const formattedRecTime = `${String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:${String(
    recordingSeconds % 60
  ).padStart(2, '0')}`;

  return (
    <div className="flex-1 min-h-0 h-full flex overflow-hidden bg-[#f6f7f9]">
      {/* COLUNA ESQUERDA: Lista de Conversas */}
      <aside
        className={`${
          activeLead ? 'hidden md:flex' : 'flex pb-16 md:pb-0'
        } w-full md:w-[360px] lg:w-[390px] h-full min-h-0 shrink-0 flex-col overflow-hidden bg-white border-r border-[#e5e9f0]`}
      >
        {/* Topo da Lista: Busca + Filtros (fixo) */}
        <div className="p-3.5 border-b border-[#e5e9f0] space-y-2.5 shrink-0">
          <div className="relative">
            <Search className="h-4 w-4 text-[#8a94a6] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conversa por nome ou telefone..."
              className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] pl-10 pr-3.5 py-2.5 text-sm font-medium text-[#0f1f38] placeholder:text-[#8a94a6] focus:border-[#012d63] focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setUnreadOnly(false)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                !unreadOnly
                  ? 'bg-[#012d63] text-white'
                  : 'bg-[#f6f7f9] text-[#5a6577] hover:bg-[#eef1f5]'
              }`}
            >
              Tudo
            </button>
            <button
              type="button"
              onClick={() => setUnreadOnly(true)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                unreadOnly
                  ? 'bg-[#eb5b29] text-white'
                  : 'bg-[#f6f7f9] text-[#5a6577] hover:bg-[#eef1f5]'
              }`}
            >
              Não lidas
              {totalUnreadChats > 0 && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    unreadOnly ? 'bg-white/25 text-white' : 'bg-[#eb5b29] text-white'
                  }`}
                >
                  {totalUnreadChats}
                </span>
              )}
            </button>

            <select
              value={stageFilterId}
              onChange={(e) => setStageFilterId(e.target.value)}
              aria-label="Filtrar por etapa do Kanban"
              className="ml-auto shrink-0 rounded-full border border-[#e5e9f0] bg-[#f6f7f9] px-2.5 py-1.5 text-[11px] font-semibold text-[#5a6577] focus:border-[#012d63] focus:outline-none cursor-pointer"
            >
              <option value="all">Todas etapas</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Lista de contatos (scroll independente) */}
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#f1f5f9]">
          {sortedFilteredLeads.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#8a94a6]">
              Nenhuma conversa encontrada com os filtros atuais.
            </div>
          ) : (
            sortedFilteredLeads.map((lead) => {
              const stage = stageMap.get(lead.stage_id);
              const isSelected = lead.id === selectedLeadId;
              const unread = lead.unread_count || 0;

              return (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => onSelectLead(lead.id)}
                  className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer ${
                    isSelected ? 'bg-[#012d63]/[0.07]' : 'hover:bg-[#f6f7f9]'
                  }`}
                >
                  {/* Avatar */}
                  <div className="h-11 w-11 rounded-full bg-[#012d63] text-white font-bold text-xs flex items-center justify-center shrink-0 overflow-hidden">
                    {lead.avatar_url ? (
                      <img
                        src={lead.avatar_url}
                        alt={lead.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      getInitials(lead.name)
                    )}
                  </div>

                  {/* Corpo do item */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-[#0f1f38] truncate">
                        {lead.name}
                      </span>
                      <span
                        className={`text-[10px] shrink-0 tabular-nums ${
                          unread > 0 ? 'font-bold text-[#eb5b29]' : 'text-[#8a94a6]'
                        }`}
                      >
                        {formatShortTime(lead.last_message_at || lead.last_activity_at)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className="text-xs text-[#5a6577] truncate">
                        {lead.last_message_preview || formatPhoneMask(lead.phone)}
                      </p>
                      {unread > 0 && (
                        <span className="h-5 min-w-5 px-1.5 rounded-full bg-[#eb5b29] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                          {unread}
                        </span>
                      )}
                    </div>

                    {/* Indicação sutil de etapa e tags */}
                    <div className="flex items-center gap-1.5 mt-1.5 overflow-hidden">
                      {stage && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-[#f6f7f9] border border-[#e5e9f0] px-1.5 py-0.5 text-[10px] font-semibold text-[#5a6577] truncate">
                          <span
                            className="h-1.5 w-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: stage.color }}
                          />
                          {stage.name}
                        </span>
                      )}
                      {lead.tags.slice(0, 2).map((t) => (
                        <span
                          key={t.id}
                          className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase text-white shrink-0"
                          style={{ backgroundColor: t.color || '#012d63' }}
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* COLUNA DIREITA: Área do Chat */}
      <section
        className={`${
          activeLead ? 'flex' : 'hidden md:flex'
        } flex-1 h-full min-h-0 flex-col min-w-0 overflow-hidden bg-[#f6f7f9] relative`}
      >
        {!activeLead ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="h-16 w-16 rounded-3xl bg-[#012d63]/8 text-[#012d63] flex items-center justify-center mb-4">
              <MessageCircle className="h-8 w-8" />
            </div>
            <h2 className="text-lg font-bold text-[#012d63]">Atendimento HP Academy</h2>
            <p className="text-sm text-[#5a6577] max-w-sm mt-1">
              Selecione uma conversa à esquerda para atender em tempo real, enviar materiais da
              biblioteca e mover o lead no Kanban sem sair da tela.
            </p>
          </div>
        ) : (
          <>
            {/* Cabeçalho do Chat */}
            <header className="h-16 px-3 sm:px-5 bg-white border-b border-[#e5e9f0] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => onSelectLead(null)}
                  aria-label="Voltar para conversas"
                  className="md:hidden p-2 -ml-1 rounded-xl text-[#012d63] hover:bg-[#f6f7f9] cursor-pointer"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>

                {/* Clicar no avatar/nome abre a Gaveta do Card por cima sem sair do chat */}
                <button
                  type="button"
                  onClick={() => onOpenLeadDrawer(activeLead)}
                  title="Abrir ficha do lead (anotações, tags e tarefas)"
                  className="flex items-center gap-2.5 min-w-0 text-left group cursor-pointer"
                >
                  <div className="h-10 w-10 rounded-full bg-[#012d63] text-white font-bold text-xs flex items-center justify-center shrink-0 overflow-hidden ring-2 ring-transparent group-hover:ring-[#eb5b29]/40 transition-all">
                    {activeLead.avatar_url ? (
                      <img
                        src={activeLead.avatar_url}
                        alt={activeLead.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      getInitials(activeLead.name)
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-[#0f1f38] group-hover:text-[#012d63] truncate">
                      {activeLead.name}
                    </h2>
                    <p className="text-[11px] font-medium text-[#5a6577] tabular-nums truncate">
                      {formatPhoneMask(activeLead.phone)} · toque para ver ficha
                    </p>
                  </div>
                </button>
              </div>

              {/* Pílula interativa da etapa do Kanban (Referência do print!) */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setStageMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-full bg-[#012d63] hover:bg-[#001f47] text-white px-3.5 py-2 text-[11px] sm:text-xs font-bold uppercase tracking-wider shadow-sm transition-all cursor-pointer"
                >
                  <Kanban className="h-3.5 w-3.5 text-[#eb5b29] shrink-0" />
                  <span className="max-w-[115px] sm:max-w-[180px] truncate">
                    {activeStage?.name || 'Etapa'}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-80 shrink-0" />
                </button>

                {stageMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-20"
                      onClick={() => setStageMenuOpen(false)}
                    />
                    <div className="absolute right-0 top-full mt-2 z-30 w-56 rounded-2xl bg-white shadow-xl border border-[#e5e9f0] py-1.5 overflow-hidden">
                      <div className="px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8a94a6]">
                        Mover no Kanban
                      </div>
                      {stages.map((st) => {
                        const current = st.id === activeLead.stage_id;
                        return (
                          <button
                            key={st.id}
                            type="button"
                            disabled={current}
                            onClick={() => {
                              setStageMenuOpen(false);
                              onRequestMove(activeLead, st.id);
                            }}
                            className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-xs font-semibold transition-colors ${
                              current
                                ? 'bg-[#f6f7f9] text-[#8a94a6] cursor-default'
                                : 'text-[#0f1f38] hover:bg-[#012d63]/6 cursor-pointer'
                            }`}
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: st.color }}
                            />
                            <span className="truncate">{st.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </header>

            {/* Corpo da Conversa (scroll independente) */}
            <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4 space-y-2.5">
              {loadingMsgs ? (
                <div className="flex items-center justify-center py-12 gap-2 text-xs text-[#5a6577]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#012d63]" />
                  Carregando histórico...
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-xs font-semibold text-[#5a6577] bg-white border border-[#e5e9f0] rounded-full px-4 py-2 shadow-2xs">
                    Nenhuma mensagem sincronizada ainda. Envie a primeira abaixo!
                  </p>
                </div>
              ) : (
                messages.map((msg, idx) => {
                  const prevMsg = idx > 0 ? messages[idx - 1] : null;
                  const showDay =
                    !prevMsg ||
                    formatDayDivider(prevMsg.created_at) !== formatDayDivider(msg.created_at);
                  const isOutbound = msg.direction === 'outbound';

                  return (
                    <div key={msg.id}>
                      {showDay && (
                        <div className="flex justify-center my-3">
                          <span className="rounded-full bg-white border border-[#e5e9f0] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#5a6577] shadow-2xs">
                            {formatDayDivider(msg.created_at)}
                          </span>
                        </div>
                      )}

                      <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 shadow-2xs ${
                            isOutbound
                              ? 'bg-[#012d63] text-white rounded-br-sm'
                              : 'bg-white text-[#0f1f38] border border-[#e5e9f0] rounded-bl-sm'
                          }`}
                        >
                          {msg.message_type !== 'text' && (
                            <OnDemandMediaContent msg={msg} isOutbound={isOutbound} />
                          )}

                          {msg.body && (
                            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                              {msg.body}
                            </p>
                          )}

                          <div
                            className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${
                              isOutbound ? 'text-white/70' : 'text-[#8a94a6]'
                            }`}
                          >
                            {isOutbound && msg.sent_by && (
                              <span className="mr-1 opacity-75">{msg.sent_by}</span>
                            )}
                            <span className="tabular-nums">
                              {new Date(msg.created_at).toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            {isOutbound && <MessageStatusIcon status={msg.status} />}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Erro de envio */}
            {sendError && (
              <div className="mx-4 mb-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2 text-xs font-medium text-red-700 flex items-center justify-between gap-2">
                <span>{sendError}</span>
                <button type="button" onClick={() => setSendError(null)} className="cursor-pointer">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Preview de anexo pendente (Clipe) */}
            {pendingFile && (
              <div className="mx-3 sm:mx-4 mb-2 rounded-xl bg-white border border-[#e5e9f0] px-3.5 py-2.5 flex items-center justify-between gap-2 shadow-xs">
                <div className="flex items-center gap-2 min-w-0">
                  {pendingFile.type.startsWith('image/') ? (
                    <ImageIcon className="h-4 w-4 text-[#eb5b29] shrink-0" />
                  ) : (
                    <FileText className="h-4 w-4 text-[#eb5b29] shrink-0" />
                  )}
                  <span className="text-xs font-semibold text-[#012d63] truncate">
                    {pendingFile.name}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingFile(null)}
                  className="p-1 text-[#8a94a6] hover:text-red-600 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Seletor Rápido da Biblioteca do CRM (Estrela) */}
            {libraryOpen && (
              <div className="mx-3 sm:mx-4 mb-2 rounded-2xl bg-white border border-[#e5e9f0] shadow-xl overflow-hidden animate-sheet-up max-h-72 flex flex-col">
                <div className="px-4 py-2.5 bg-[#f6f7f9] border-b border-[#e5e9f0] flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#012d63]">
                    <Star className="h-3.5 w-3.5 text-[#eb5b29] fill-[#eb5b29]" />
                    Biblioteca de Materiais (envio com 1 toque)
                  </div>
                  <button
                    type="button"
                    onClick={() => setLibraryOpen(false)}
                    className="p-1 text-[#8a94a6] hover:text-[#012d63] cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="overflow-y-auto divide-y divide-[#f1f5f9]">
                  {templates.length === 0 ? (
                    <p className="p-4 text-xs text-center text-[#8a94a6]">
                      Nenhum material salvo na Biblioteca ainda.
                    </p>
                  ) : (
                    templates.map((tpl) => {
                      const preview = applyTemplateVariables(tpl.body, activeLead.name);
                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => handleSendTemplate(tpl)}
                          className="w-full text-left px-4 py-3 hover:bg-[#f6f7f9] transition-colors flex items-start justify-between gap-3 cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-[#012d63]">{tpl.title}</span>
                              {tpl.file_name && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-[#012d63]/8 px-1.5 py-0.5 text-[10px] font-semibold text-[#012d63]">
                                  <Paperclip className="h-2.5 w-2.5" />
                                  {tpl.file_type === 'application/pdf' ? 'PDF' : 'Img'}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-[#5a6577] line-clamp-2 mt-0.5">
                              {preview || 'Somente anexo'}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-lg bg-[#eb5b29] text-white px-2.5 py-1 text-[10px] font-bold">
                            Enviar
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Rodapé: Clipe + Estrela + Campo de Texto + Enviar / Microfone (fixo na base com respiro inferior) */}
            <footer className="px-3 sm:px-5 pt-3 pb-4 md:pb-5 bg-white border-t border-[#e5e9f0] shrink-0 safe-pb">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                onChange={handleFilePicked}
                className="hidden"
              />

              {recording ? (
                <div className="flex items-center justify-between gap-3 bg-rose-50 border border-rose-200 rounded-2xl px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-600 animate-pulse" />
                    <span className="text-xs font-bold text-rose-700 tabular-nums">
                      Gravando áudio · {formattedRecTime}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={cancelRecording}
                      title="Cancelar gravação"
                      className="p-2 rounded-xl bg-white text-rose-600 border border-rose-200 hover:bg-rose-100 cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={stopAndSendRecording}
                      title="Parar e enviar áudio"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#eb5b29] hover:bg-[#d44d1f] text-white px-3.5 py-2 text-xs font-bold cursor-pointer"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                      Enviar áudio
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-end gap-1.5 sm:gap-2">
                  {/* Clipe: Anexo Normal */}
                  <button
                    type="button"
                    title="Anexar foto, PDF ou documento"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-10 w-10 shrink-0 rounded-xl flex items-center justify-center text-[#5a6577] hover:text-[#012d63] hover:bg-[#f6f7f9] transition-colors cursor-pointer"
                  >
                    <Paperclip className="h-5 w-5" />
                  </button>

                  {/* Estrela: Materiais da Biblioteca do CRM (exatamente ao lado do clipe!) */}
                  <button
                    type="button"
                    title="Enviar material da Biblioteca do CRM"
                    onClick={() => setLibraryOpen((v) => !v)}
                    className={`h-10 w-10 shrink-0 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                      libraryOpen
                        ? 'bg-[#eb5b29]/12 text-[#eb5b29]'
                        : 'text-[#5a6577] hover:text-[#eb5b29] hover:bg-[#f6f7f9]'
                    }`}
                  >
                    <Star className={`h-5 w-5 ${libraryOpen ? 'fill-[#eb5b29]' : ''}`} />
                  </button>

                  {/* Campo de texto */}
                  <textarea
                    rows={1}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Digite uma mensagem..."
                    className="flex-1 max-h-28 rounded-2xl border border-[#e5e9f0] bg-[#f6f7f9] px-4 py-2.5 text-sm text-[#0f1f38] placeholder:text-[#8a94a6] focus:border-[#012d63] focus:bg-white focus:outline-none resize-none"
                  />

                  {/* Enviar ou Gravar Áudio */}
                  {draft.trim() || pendingFile ? (
                    <button
                      type="button"
                      disabled={sending}
                      onClick={handleSendTextOrFile}
                      aria-label="Enviar mensagem"
                      className="h-10 w-10 shrink-0 rounded-xl bg-[#eb5b29] hover:bg-[#d44d1f] text-white flex items-center justify-center shadow-sm shadow-[#eb5b29]/25 disabled:opacity-60 cursor-pointer"
                    >
                      {sending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={sending}
                      onClick={startRecording}
                      title="Gravar áudio"
                      aria-label="Gravar áudio"
                      className="h-10 w-10 shrink-0 rounded-xl bg-[#012d63] hover:bg-[#001f47] text-white flex items-center justify-center shadow-sm disabled:opacity-60 cursor-pointer"
                    >
                      {sending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Mic className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              )}
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
