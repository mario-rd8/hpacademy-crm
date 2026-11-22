import { crmDb } from './supabaseClient';
import type { Lead, MessageLog } from '../types/database.types';

const WEBHOOK_SEND_MESSAGE = import.meta.env.VITE_WEBHOOK_SEND_MESSAGE as string | undefined;
const WEBHOOK_BULK_SEND = import.meta.env.VITE_WEBHOOK_BULK_SEND as string | undefined;
const EVOLUTION_INSTANCE = (import.meta.env.VITE_EVOLUTION_INSTANCE as string | undefined) || 'evaflow';

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
  const { lead, messageBody, templateId = null, mediaUrl = null, fileName = null, fileType = null, sentBy } = params;

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

  if (!WEBHOOK_SEND_MESSAGE) {
    const detail = 'VITE_WEBHOOK_SEND_MESSAGE não configurado no ambiente.';
    await crmDb()
      .from('message_logs')
      .update({ status: 'error', error_detail: detail })
      .eq('id', createdLog.id);
    throw new Error(detail);
  }

  try {
    const response = await fetch(WEBHOOK_SEND_MESSAGE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    if (!response.ok) {
      const errText = await response.text().catch(() => `HTTP ${response.status}`);
      await crmDb()
        .from('message_logs')
        .update({ status: 'error', error_detail: errText.slice(0, 500) })
        .eq('id', createdLog.id);
      throw new Error(`Falha no webhook (${response.status}): ${errText}`);
    }

    const resData = await response.json().catch(() => null);
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
    const detail = err instanceof Error ? err.message : 'Erro desconhecido ao chamar webhook.';
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
  if (!WEBHOOK_BULK_SEND) {
    throw new Error('VITE_WEBHOOK_BULK_SEND não configurado no ambiente.');
  }

  const response = await fetch(WEBHOOK_BULK_SEND, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instance: EVOLUTION_INSTANCE,
      lead_ids: params.leadIds,
      template_id: params.templateId,
      custom_message: params.customMessage || null,
      sent_by: params.sentBy,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(`Falha no disparo em massa (${response.status}): ${errText}`);
  }
}
