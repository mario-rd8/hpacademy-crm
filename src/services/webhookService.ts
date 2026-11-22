import { crmDb, supabase } from './supabaseClient';
import type { Lead, MessageLog } from '../types/database.types';

// Endpoints nativos do servidor do CRM (sem n8n) — podem ser sobrescritos via VITE_WEBHOOK_*
const ENDPOINT_SEND_MESSAGE =
  (import.meta.env.VITE_WEBHOOK_SEND_MESSAGE as string | undefined) || '/api/messages/send';
const ENDPOINT_BULK_SEND =
  (import.meta.env.VITE_WEBHOOK_BULK_SEND as string | undefined) || '/api/messages/bulk';
const EVOLUTION_INSTANCE =
  (import.meta.env.VITE_EVOLUTION_INSTANCE as string | undefined) || 'evaflow';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface SendSingleMessageParams {
  lead: Lead;
  messageBody: string;
  templateId?: string | null;
  mediaUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  sentBy: string;
}

export async function sendSingleMessage(params: SendSingleMessageParams): Promise<MessageLog> {
  const {
    lead,
    messageBody,
    templateId = null,
    mediaUrl = null,
    fileName = null,
    fileType = null,
    sentBy,
  } = params;

  // 1. Cria o registro em crm.message_logs como pending para acompanhamento via Realtime
  const { data: createdLog, error: insertError } = await crmDb()
    .from('message_logs')
    .insert({
      lead_id: lead.id,
      template_id: templateId,
      message_body: messageBody,
      media_url: mediaUrl,
      status: 'pending',
      sent_by: sentBy,
    })
    .select()
    .single();

  if (insertError || !createdLog) {
    throw new Error(insertError?.message || 'Erro ao registrar disparo no banco.');
  }

  try {
    const headers = await getAuthHeaders();
    const response = await fetch(ENDPOINT_SEND_MESSAGE, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message_log_id: createdLog.id,
        instance: EVOLUTION_INSTANCE,
        lead_id: lead.id,
        lead_name: lead.name,
        phone: lead.phone,
        text: messageBody,
        media_url: mediaUrl,
        file_name: fileName,
        file_type: fileType,
        template_id: templateId,
        sent_by: sentBy,
      }),
    });

    const resData = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = resData?.error || `Falha no envio (${response.status})`;
      await crmDb()
        .from('message_logs')
        .update({ status: 'error', error_detail: String(detail).slice(0, 500) })
        .eq('id', createdLog.id);
      throw new Error(detail);
    }

    const evolutionId = resData?.evolution_message_id || resData?.key?.id || null;

    const { data: updatedLog } = await crmDb()
      .from('message_logs')
      .update({
        status: 'sent',
        ...(evolutionId ? { evolution_message_id: evolutionId } : {}),
      })
      .eq('id', createdLog.id)
      .select()
      .single();

    return (updatedLog || createdLog) as MessageLog;
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Erro desconhecido ao enviar mensagem.';
    await crmDb()
      .from('message_logs')
      .update({ status: 'error', error_detail: detail.slice(0, 500) })
      .eq('id', createdLog.id);
    throw err;
  }
}

export interface SendBulkMessagesParams {
  leadIds: string[];
  templateId: string | null;
  customMessage?: string;
  sentBy: string;
}

export async function sendBulkMessages(params: SendBulkMessagesParams): Promise<void> {
  const headers = await getAuthHeaders();
  const response = await fetch(ENDPOINT_BULK_SEND, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      instance: EVOLUTION_INSTANCE,
      lead_ids: params.leadIds,
      template_id: params.templateId,
      custom_message: params.customMessage || null,
      sent_by: params.sentBy,
    }),
  });

  if (!response.ok) {
    const resData = await response.json().catch(() => null);
    throw new Error(resData?.error || `Falha no disparo em massa (${response.status})`);
  }
}
