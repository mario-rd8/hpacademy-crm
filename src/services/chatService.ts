import { crmDb, supabase } from './supabaseClient';
import type { ChatMessage } from '../types/database.types';

async function getAuthHeaders(json = true): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function sendChatMessage(params: {
  leadId: string;
  phone: string;
  text?: string;
  mediaUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  templateId?: string | null;
  sentBy: string;
}): Promise<ChatMessage> {
  const headers = await getAuthHeaders(true);
  const res = await fetch('/api/chat/send', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      lead_id: params.leadId,
      phone: params.phone,
      text: params.text || '',
      media_url: params.mediaUrl || null,
      file_name: params.fileName || null,
      file_type: params.fileType || null,
      template_id: params.templateId || null,
      sent_by: params.sentBy,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Falha ao enviar mensagem (${res.status})`);
  }
  return data.message as ChatMessage;
}

export async function sendChatAudio(params: {
  leadId: string;
  phone: string;
  audioBlob: Blob;
  sentBy: string;
}): Promise<ChatMessage> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Falha ao ler áudio gravado.'));
    reader.readAsDataURL(params.audioBlob);
  });

  const headers = await getAuthHeaders(true);
  const res = await fetch('/api/chat/send-audio', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      lead_id: params.leadId,
      phone: params.phone,
      audio_base64: base64,
      mime_type: params.audioBlob.type || 'audio/webm',
      sent_by: params.sentBy,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Falha ao enviar áudio (${res.status})`);
  }
  return data.message as ChatMessage;
}

export async function uploadChatAttachment(file: File): Promise<{
  url: string;
  fileName: string;
  fileType: string;
}> {
  const ext = file.name.split('.').pop() || 'bin';
  const safePath = `chat/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from('crm-media')
    .upload(safePath, file, { upsert: false, contentType: file.type || 'application/octet-stream' });

  if (error) {
    throw new Error(`Erro ao subir arquivo: ${error.message}`);
  }

  const { data } = supabase.storage.from('crm-media').getPublicUrl(safePath);
  return {
    url: data.publicUrl,
    fileName: file.name,
    fileType: file.type || 'application/octet-stream',
  };
}

/**
 * Baixa mídia recebida sob demanda direto da Evolution API (sem salvar base64 no Postgres).
 */
export async function fetchOnDemandMediaUrl(messageId: string): Promise<{
  objectUrl: string;
  mimeType: string;
}> {
  const headers = await getAuthHeaders(false);
  const res = await fetch(`/api/chat/media/${encodeURIComponent(messageId)}`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error || `Não foi possível carregar mídia (${res.status})`);
  }

  const blob = await res.blob();
  return {
    objectUrl: URL.createObjectURL(blob),
    mimeType: res.headers.get('Content-Type') || blob.type || 'application/octet-stream',
  };
}

export async function markLeadMessagesRead(leadId: string): Promise<void> {
  await crmDb().from('leads').update({ unread_count: 0 }).eq('id', leadId);
}
