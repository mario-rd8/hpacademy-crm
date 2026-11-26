/**
 * Servidor de Produção — HP Academy CRM (100% sem n8n)
 * 1. Serve a SPA compilada (dist/) com fallback para index.html
 * 2. POST /api/messages/send      -> Envio individual via Evolution API (chave protegida no servidor)
 * 3. POST /api/messages/bulk      -> Disparo em massa com fila segura e log Realtime no Supabase
 * 4. POST /api/webhooks/evolution -> Recebe:
 *      - MESSAGES_UPDATE: atualiza status (sent, delivered, read, error) em crm.message_logs
 *      - MESSAGES_UPSERT:
 *          * Comandos iniciados com @crm (consultas e criação de card por texto)
 *          * Contatos compartilhados (vCard único ou múltiplos) -> cria card automaticamente
 *          (Restrito exclusivamente aos números autorizados em crm.profiles)
 * 5. POST /api/webhooks/lead      -> Recebe novos leads do site hpacademy.com.br
 * 6. GET  /api/health             -> Healthcheck
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || 'https://evo.evaflow.com.br').replace(/\/$/, '');
const DEFAULT_EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'evaflow';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const CRM_WEBHOOK_SECRET = process.env.CRM_WEBHOOK_SECRET || '';
const CRM_PUBLIC_URL = (process.env.CRM_PUBLIC_URL || 'https://crm.hpacademy.com.br').replace(/\/$/, '');
// Protege a instância compartilhada do site da EvaFlow contra exclusão acidental na Evolution API
const PROTECTED_INSTANCES = new Set(['evaflow']);

let activeInstanceCache = { value: null, expiresAt: 0 };

function invalidateActiveInstanceCache() {
  activeInstanceCache = { value: null, expiresAt: 0 };
}

function sanitizeInstanceName(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 48);
}

function mapConnectionState(rawState) {
  const s = String(rawState || '').toLowerCase();
  if (s === 'open' || s === 'connected') return 'connected';
  if (s === 'connecting' || s === 'qrcode') return 'connecting';
  return 'disconnected';
}

async function getWhatsAppSettingsRow() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const rows = await supabaseRest('whatsapp_settings?id=eq.true&select=*');
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}

async function getActiveInstanceName() {
  const now = Date.now();
  if (activeInstanceCache.value && activeInstanceCache.expiresAt > now) {
    return activeInstanceCache.value;
  }
  const row = await getWhatsAppSettingsRow();
  const resolved = row?.instance_name || DEFAULT_EVOLUTION_INSTANCE;
  activeInstanceCache = { value: resolved, expiresAt: now + 10_000 };
  return resolved;
}

async function evolutionRequest(evoPath, { method = 'GET', body } = {}) {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    throw new Error('Evolution API não configurada no servidor (EVOLUTION_API_KEY ausente).');
  }
  const headers = { apikey: EVOLUTION_API_KEY };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${EVOLUTION_API_URL}${evoPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const rawText = await res.text().catch(() => '');
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = { raw: rawText };
  }

  return { ok: res.ok, status: res.status, data, rawText };
}

function extractQrCodeData(data) {
  const rawBase64 =
    data?.base64 ||
    data?.qrcode?.base64 ||
    data?.data?.base64 ||
    null;
  const qrcode = rawBase64
    ? rawBase64.startsWith('data:image')
      ? rawBase64
      : `data:image/png;base64,${rawBase64}`
    : null;
  const pairingCode = data?.pairingCode || data?.qrcode?.pairingCode || null;
  return { qrcode, pairingCode };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};

// Cache curto de mensagens já processadas para evitar duplicidade em reenvios de webhook
const processedMessageIds = new Map();
function markMessageProcessed(id) {
  if (!id) return false;
  const now = Date.now();
  for (const [k, ts] of processedMessageIds) {
    if (now - ts > 5 * 60_000) processedMessageIds.delete(k);
  }
  if (processedMessageIds.has(id)) return true;
  processedMessageIds.set(id, now);
  return false;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, limitBytes = 500_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limitBytes) {
        req.destroy();
        reject(new Error('Payload muito grande'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

async function verifySupabaseJwt(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function supabaseRest(restPath, { method = 'GET', body, schema = 'crm', prefer } = {}) {
  const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Accept-Profile': schema,
    'Content-Profile': schema,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${restPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Supabase REST erro (${res.status}): ${errText}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

function normalizePhoneBr(v) {
  const d = onlyDigits(v);
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return d;
}

function formatPhoneBr(v) {
  const d = onlyDigits(v).replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v || '';
}

function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getFirstName(fullName) {
  const first = String(fullName || '').trim().split(/\s+/)[0] || '';
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';
}

function applyTemplateVars(text, leadName) {
  const firstName = getFirstName(leadName);
  return String(text || '').replace(/\{\{\s*nome\s*\}\}/gi, firstName || 'tudo bem');
}

function formatDateBr(iso) {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Recife',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function daysInactive(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0;
}

/**
 * Compara telefones brasileiros tolerando o 9º dígito (ex: 5581995008282 vs 558195008282).
 */
function phonesMatch(a, b) {
  const da = normalizePhoneBr(a);
  const db = normalizePhoneBr(b);
  if (!da || !db) return false;
  if (da === db) return true;
  // Compara DDD + últimos 8 dígitos
  if (da.startsWith('55') && db.startsWith('55') && da.length >= 12 && db.length >= 12) {
    return da.slice(0, 4) === db.slice(0, 4) && da.slice(-8) === db.slice(-8);
  }
  return false;
}

async function dispatchToEvolution({ phone, text, mediaUrl, fileName, fileType, instanceOverride }) {
  const activeInstance = instanceOverride || (await getActiveInstanceName());
  if (!EVOLUTION_API_URL || !activeInstance || !EVOLUTION_API_KEY) {
    throw new Error('Evolution API não configurada no servidor (EVOLUTION_API_KEY ou instância ausente).');
  }

  const cleanNumber = onlyDigits(phone);
  let endpoint = `${EVOLUTION_API_URL}/message/sendText/${encodeURIComponent(activeInstance)}`;
  let payload;

  if (mediaUrl) {
    endpoint = `${EVOLUTION_API_URL}/message/sendMedia/${encodeURIComponent(activeInstance)}`;
    const isPdf = fileType === 'application/pdf' || String(fileName || '').toLowerCase().endsWith('.pdf');
    payload = {
      number: cleanNumber,
      mediatype: isPdf ? 'document' : 'image',
      mimetype: fileType || (isPdf ? 'application/pdf' : 'image/png'),
      caption: text || '',
      media: mediaUrl,
      fileName: fileName || (isPdf ? 'material.pdf' : 'material.png'),
    };
  } else {
    payload = {
      number: cleanNumber,
      text: text || '',
    };
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: EVOLUTION_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const rawText = await res.text().catch(() => '');
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = { raw: rawText };
  }

  if (!res.ok) {
    throw new Error(`Evolution API erro (${res.status}): ${rawText.slice(0, 300)}`);
  }

  return {
    evolutionMessageId: data?.key?.id || data?.message?.key?.id || data?.id || null,
    raw: data,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recordOutboundChatMessage({
  leadId,
  evolutionMessageId,
  messageType = 'text',
  body = '',
  mediaUrl = null,
  mediaMime = null,
  mediaFileName = null,
  evolutionKey = null,
  sentBy = 'Equipe HP',
}) {
  if (!leadId || !SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const rows = await supabaseRest('chat_messages', {
      method: 'POST',
      prefer: 'resolution=ignore-duplicates,return=representation',
      body: {
        lead_id: leadId,
        evolution_message_id: evolutionMessageId || null,
        direction: 'outbound',
        message_type: messageType,
        body: body || '',
        media_url: mediaUrl || null,
        media_mime: mediaMime || null,
        media_file_name: mediaFileName || null,
        evolution_key: evolutionKey || null,
        status: 'sent',
        sent_by: sentBy || 'Equipe HP',
      },
    });
    return Array.isArray(rows) ? rows[0] || null : rows;
  } catch (err) {
    console.warn('[CHAT SYNC OUTBOUND WARN]', err.message);
    return null;
  }
}

function inferMessageType(fileType, fileName) {
  const mime = String(fileType || '').toLowerCase();
  const name = String(fileName || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(name)) return 'image';
  if (mime.startsWith('audio/') || /\.(ogg|mp3|wav|webm|m4a)$/.test(name)) return 'audio';
  if (mime.startsWith('video/') || /\.(mp4|mov|mkv)$/.test(name)) return 'video';
  if (mime || name) return 'document';
  return 'text';
}

function parseIncomingWhatsAppMessage(msgObj) {
  if (!msgObj || typeof msgObj !== 'object') return null;

  // Desembrulha mensagens encapsuladas (ephemeral / viewOnce)
  const inner =
    msgObj.ephemeralMessage?.message ||
    msgObj.viewOnceMessage?.message ||
    msgObj.viewOnceMessageV2?.message ||
    msgObj;

  // Ignora figurinhas, reações e mensagens de protocolo
  if (
    inner.stickerMessage ||
    inner.reactionMessage ||
    inner.protocolMessage ||
    inner.senderKeyDistributionMessage
  ) {
    if (
      !inner.conversation &&
      !inner.extendedTextMessage &&
      !inner.imageMessage &&
      !inner.audioMessage &&
      !inner.documentMessage &&
      !inner.videoMessage
    ) {
      return null;
    }
  }

  if (inner.imageMessage) {
    return {
      messageType: 'image',
      body: inner.imageMessage.caption || '',
      mediaMime: inner.imageMessage.mimetype || 'image/jpeg',
      mediaFileName: 'foto.jpg',
    };
  }
  if (inner.audioMessage) {
    return {
      messageType: 'audio',
      body: '',
      mediaMime: inner.audioMessage.mimetype || 'audio/ogg',
      mediaFileName: 'audio.ogg',
    };
  }
  if (inner.documentMessage) {
    return {
      messageType: 'document',
      body: inner.documentMessage.caption || '',
      mediaMime: inner.documentMessage.mimetype || 'application/octet-stream',
      mediaFileName: inner.documentMessage.fileName || 'documento',
    };
  }
  if (inner.documentWithCaptionMessage?.message?.documentMessage) {
    const doc = inner.documentWithCaptionMessage.message.documentMessage;
    return {
      messageType: 'document',
      body: doc.caption || '',
      mediaMime: doc.mimetype || 'application/octet-stream',
      mediaFileName: doc.fileName || 'documento',
    };
  }
  if (inner.videoMessage) {
    return {
      messageType: 'video',
      body: inner.videoMessage.caption || '',
      mediaMime: inner.videoMessage.mimetype || 'video/mp4',
      mediaFileName: 'video.mp4',
    };
  }

  const text = (inner.conversation || inner.extendedTextMessage?.text || '').trim();
  if (!text) return null;

  return {
    messageType: 'text',
    body: text,
    mediaMime: null,
    mediaFileName: null,
  };
}

async function findOrCreateLeadForChat(phoneRaw, pushName, isInbound) {
  const cleanPhone = normalizePhoneBr(phoneRaw);
  if (cleanPhone.length < 12) return null;

  // 1. Busca exata
  const exact = await supabaseRest(
    `leads?phone=eq.${encodeURIComponent(cleanPhone)}&select=id,name,phone,stage_id`
  );
  if (Array.isArray(exact) && exact.length > 0) return exact[0];

  // 2. Busca tolerando 9º dígito (DDD + últimos 8)
  if (cleanPhone.startsWith('55') && cleanPhone.length >= 12) {
    const last8 = cleanPhone.slice(-8);
    const candidates = await supabaseRest(
      `leads?phone=like.*${encodeURIComponent(last8)}&select=id,name,phone,stage_id`
    );
    const matched = (candidates || []).find((c) => phonesMatch(c.phone, cleanPhone));
    if (matched) return matched;
  }

  // 3. Não existe: cria automaticamente em "Contato novo"
  const stages = await supabaseRest('stages?select=id,slug,position&order=position.asc');
  const defaultStage =
    (stages || []).find((s) => s.slug === 'contato-novo') || (stages || [])[0];
  if (!defaultStage) return null;

  const leadName =
    (isInbound && pushName && String(pushName).trim()) || formatPhoneBr(cleanPhone);

  const created = await supabaseRest('leads', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      name: leadName.slice(0, 120),
      phone: cleanPhone,
      stage_id: defaultStage.id,
      source: 'whatsapp',
      has_whatsapp: true,
      is_returning: false,
      last_activity_at: new Date().toISOString(),
    },
  });

  return Array.isArray(created) ? created[0] || null : created;
}

async function dispatchAudioToEvolution({ phone, audioBase64 }) {
  const activeInstance = await getActiveInstanceName();
  if (!EVOLUTION_API_URL || !activeInstance || !EVOLUTION_API_KEY) {
    throw new Error('Evolution API não configurada no servidor.');
  }
  const cleanNumber = onlyDigits(phone);
  const res = await fetch(
    `${EVOLUTION_API_URL}/message/sendWhatsAppAudio/${encodeURIComponent(activeInstance)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({
        number: cleanNumber,
        audio: audioBase64,
      }),
    }
  );
  const rawText = await res.text().catch(() => '');
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = { raw: rawText };
  }
  if (!res.ok) {
    throw new Error(`Evolution API erro áudio (${res.status}): ${rawText.slice(0, 300)}`);
  }
  return {
    evolutionMessageId: data?.key?.id || data?.message?.key?.id || data?.id || null,
    key: data?.key || null,
  };
}

async function processBulkQueue({ leadIds, templateId, customMessage, sentBy }) {
  try {
    let template = null;
    if (templateId) {
      const rows = await supabaseRest(`media_templates?id=eq.${encodeURIComponent(templateId)}&select=*`);
      template = rows?.[0] || null;
    }

    const encodedIds = leadIds.map((id) => encodeURIComponent(id)).join(',');
    const leads = await supabaseRest(`leads?id=in.(${encodedIds})&select=id,name,phone,has_whatsapp`);

    for (let i = 0; i < (leads || []).length; i++) {
      const lead = leads[i];
      if (!lead.has_whatsapp) continue;

      const rawText = template ? template.body : customMessage || '';
      const messageBody = applyTemplateVars(rawText, lead.name);

      const createdRows = await supabaseRest('message_logs', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          lead_id: lead.id,
          template_id: template?.id || null,
          message_body: messageBody,
          media_url: template?.file_url || null,
          status: 'pending',
          sent_by: sentBy || 'Equipe HP',
        },
      });
      const logId = createdRows?.[0]?.id;

      try {
        const result = await dispatchToEvolution({
          phone: lead.phone,
          text: messageBody,
          mediaUrl: template?.file_url || null,
          fileName: template?.file_name || null,
          fileType: template?.file_type || null,
        });

        if (logId) {
          await supabaseRest(`message_logs?id=eq.${logId}`, {
            method: 'PATCH',
            body: {
              status: 'sent',
              evolution_message_id: result.evolutionMessageId,
            },
          });
        }

        await recordOutboundChatMessage({
          leadId: lead.id,
          evolutionMessageId: result.evolutionMessageId,
          messageType: template?.file_url
            ? inferMessageType(template.file_type, template.file_name)
            : 'text',
          body: messageBody,
          mediaUrl: template?.file_url || null,
          mediaMime: template?.file_type || null,
          mediaFileName: template?.file_name || null,
          sentBy: sentBy || 'Equipe HP',
        });
      } catch (err) {
        if (logId) {
          await supabaseRest(`message_logs?id=eq.${logId}`, {
            method: 'PATCH',
            body: {
              status: 'error',
              error_detail: String(err?.message || err).slice(0, 500),
            },
          });
        }
      }

      if (i < leads.length - 1) {
        await sleep(2500 + Math.floor(Math.random() * 2000));
      }
    }
  } catch (err) {
    console.error('[BULK QUEUE ERROR]', err);
  }
}

function mapEvolutionStatus(rawStatus) {
  const s = String(rawStatus || '').toUpperCase();
  if (s === 'READ' || s === 'PLAYED' || s === '4' || s === '5') return 'read';
  if (s === 'DELIVERY_ACK' || s === 'DELIVERED' || s === '3') return 'delivered';
  if (s === 'SERVER_ACK' || s === 'SENT' || s === '2') return 'sent';
  if (s === 'ERROR' || s === 'FAILED' || s === '0') return 'error';
  return null;
}

// =============================================================================
// Assistente WhatsApp (@crm + Contatos Compartilhados via vCard)
// =============================================================================

async function findAuthorizedProfile(senderPhone) {
  if (!senderPhone || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const profiles = await supabaseRest('profiles?select=id,full_name,phone,role');
  return (profiles || []).find((p) => phonesMatch(p.phone, senderPhone)) || null;
}

function parseVcard(displayName, vcardText) {
  const vcard = String(vcardText || '');
  const fnMatch = vcard.match(/^FN[^:]*:(.+)$/im);
  const name = String(displayName || fnMatch?.[1] || '').trim();

  // Prioriza waid=55... se existir no vCard
  const waidMatch = vcard.match(/waid=(\d{10,15})/i);
  let phone = waidMatch ? waidMatch[1] : '';

  if (!phone) {
    const telMatch = vcard.match(/^TEL[^:]*:(.+)$/im);
    if (telMatch) phone = onlyDigits(telMatch[1]);
  }

  phone = normalizePhoneBr(phone);
  return { name: name || formatPhoneBr(phone) || 'Contato WhatsApp', phone };
}

function extractSharedContacts(message) {
  if (!message) return [];
  const contacts = [];
  if (message.contactMessage) {
    contacts.push(parseVcard(message.contactMessage.displayName, message.contactMessage.vcard));
  }
  if (message.contactsArrayMessage?.contacts) {
    for (const c of message.contactsArrayMessage.contacts) {
      contacts.push(parseVcard(c.displayName, c.vcard));
    }
  }
  return contacts.filter((c) => c.phone.length >= 12);
}

function extractMessageText(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    ''
  ).trim();
}

async function handleSharedContacts(contacts, senderPhone, profile) {
  const lines = [];
  for (const contact of contacts) {
    try {
      const existing = await supabaseRest(
        `leads?phone=eq.${encodeURIComponent(contact.phone)}&select=id,name,stage_id`
      );
      const alreadyExists = Array.isArray(existing) && existing.length > 0;

      const lead = await supabaseRest('rpc/upsert_incoming_lead', {
        method: 'POST',
        body: {
          p_name: contact.name,
          p_phone: contact.phone,
          p_source: `WhatsApp (${profile.full_name})`,
          p_tags: [],
        },
      });

      if (alreadyExists) {
        lines.push(
          `🔄 *${lead.name}* (${formatPhoneBr(lead.phone)}) já tinha card — marcado como *Novo interesse*!`
        );
      } else {
        lines.push(
          `✅ *Card criado em Contato novo!*\n• *Nome:* ${lead.name}\n• *Telefone:* ${formatPhoneBr(lead.phone)}`
        );
      }
    } catch (err) {
      lines.push(`❌ Erro ao salvar *${contact.name}*: ${err.message}`);
    }
  }

  if (lines.length > 0) {
    await dispatchToEvolution({
      phone: senderPhone,
      text: `${lines.join('\n\n')}\n\n🔗 https://crm.hpacademy.com.br`,
    });
  }
}

async function handleCreateLeadCommand(argsText, senderPhone, profile) {
  // Extrai #tags se houver
  const tagMatches = [...argsText.matchAll(/#([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
  const withoutTags = argsText.replace(/#[a-zA-Z0-9_-]+/g, ' ').trim();

  // Extrai telefone (sequência com dígitos, parênteses, espaços, hífen com 10-13 dígitos)
  const phoneRegex = /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4}[-.\s]?\d{4})/;
  const phoneMatch = withoutTags.match(phoneRegex);

  if (!phoneMatch) {
    return dispatchToEvolution({
      phone: senderPhone,
      text:
        '⚠️ Informe nome e telefone.\nExemplo:\n`@crm novo Maria Clara 81999998888 #enem`',
    });
  }

  const rawPhone = phoneMatch[0];
  const cleanPhone = normalizePhoneBr(rawPhone);
  const name = withoutTags.replace(rawPhone, ' ').replace(/[-|,]+/g, ' ').replace(/\s+/g, ' ').trim();

  if (!name || cleanPhone.length < 12) {
    return dispatchToEvolution({
      phone: senderPhone,
      text:
        '⚠️ Nome ou telefone inválido.\nExemplo:\n`@crm novo Maria Clara 81999998888 #enem`',
    });
  }

  const existing = await supabaseRest(
    `leads?phone=eq.${encodeURIComponent(cleanPhone)}&select=id,name`
  );
  const alreadyExists = Array.isArray(existing) && existing.length > 0;

  const lead = await supabaseRest('rpc/upsert_incoming_lead', {
    method: 'POST',
    body: {
      p_name: name,
      p_phone: cleanPhone,
      p_source: `WhatsApp (${profile.full_name})`,
      p_tags: tagMatches,
    },
  });

  const tagInfo = tagMatches.length > 0 ? `\n• *Tags:* ${tagMatches.join(', ')}` : '';
  const msg = alreadyExists
    ? `🔄 *${lead.name}* (${formatPhoneBr(lead.phone)}) já existia no CRM — atividade atualizada e marcado como *Novo interesse*!${tagInfo}`
    : `✅ *Card criado em Contato novo!*\n• *Nome:* ${lead.name}\n• *Telefone:* ${formatPhoneBr(lead.phone)}${tagInfo}`;

  await dispatchToEvolution({
    phone: senderPhone,
    text: `${msg}\n\n🔗 https://crm.hpacademy.com.br`,
  });
}

async function handleCrmCommand(rawText, senderPhone, profile) {
  const afterPrefix = rawText.replace(/^@crm\b/i, '').trim();
  const norm = normalizeText(afterPrefix);

  // 1. Ajuda / Menu
  if (!norm || norm === 'ajuda' || norm === 'help' || norm === 'menu') {
    return dispatchToEvolution({
      phone: senderPhone,
      text: [
        `👋 Olá, *${profile.full_name}*! Comandos do *HP Academy CRM*:`,
        ``,
        `📊 *@crm resumo* — panorama geral do funil`,
        `📅 *@crm hoje* — tarefas de hoje e atrasadas`,
        `⏰ *@crm parados* — leads parados há +2 dias`,
        `🆕 *@crm novos* — últimos leads em Contato novo`,
        `🔎 *@crm buscar <nome>* — detalhes de um lead`,
        `➕ *@crm novo <nome> <telefone> #tag* — criar card`,
        `📇 *Compartilhe um contato* aqui para criar o card automaticamente!`,
      ].join('\n'),
    });
  }

  // 2. Criar card por texto
  if (norm.startsWith('novo ') || norm.startsWith('criar ') || norm.startsWith('add ')) {
    const args = afterPrefix.replace(/^(novo|criar|add)\s+/i, '').trim();
    return handleCreateLeadCommand(args, senderPhone, profile);
  }

  // Carrega dados base do CRM
  const [stages, leads, tasks] = await Promise.all([
    supabaseRest('stages?select=*&order=position.asc'),
    supabaseRest('leads?select=*,lead_tags(tags(name))&order=last_activity_at.desc'),
    supabaseRest('tasks?completed=eq.false&select=*&order=due_at.asc'),
  ]);

  const stageMap = new Map((stages || []).map((s) => [s.id, s]));

  // 3. Resumo
  if (norm === 'resumo' || norm === 'status' || norm === 'geral') {
    const counts = new Map();
    let matriculados = 0;
    let pendentesGanho = 0;
    let parados = 0;

    for (const l of leads || []) {
      counts.set(l.stage_id, (counts.get(l.stage_id) || 0) + 1);
      const st = stageMap.get(l.stage_id);
      const slug = st?.slug || '';
      if (slug === 'ganho') {
        if (l.enrollment_status === 'matriculado') matriculados++;
        else pendentesGanho++;
      } else if (slug !== 'perdido' && daysInactive(l.last_activity_at) >= 2) {
        parados++;
      }
    }

    const nowMs = Date.now();
    const overdueTasks = (tasks || []).filter((t) => new Date(t.due_at).getTime() < nowMs).length;

    const lines = [
      `📊 *Resumo — HP Academy CRM*`,
      ``,
      ...(stages || []).map((s) => `• *${s.name}:* ${counts.get(s.id) || 0}`),
      ``,
      `🎓 *Ganhos:* ${matriculados} matriculado(s) · ${pendentesGanho} pendente(s)`,
      `⏰ *Parados (+2d):* ${parados}`,
      `📌 *Tarefas abertas:* ${(tasks || []).length} (${overdueTasks} atrasada(s))`,
      `👥 *Total de leads:* ${(leads || []).length}`,
    ];

    return dispatchToEvolution({ phone: senderPhone, text: lines.join('\n') });
  }

  // 4. Tarefas de hoje e atrasadas
  if (norm === 'hoje' || norm === 'tarefas' || norm === 'atrasados' || norm === 'atrasadas') {
    const leadMap = new Map((leads || []).map((l) => [l.id, l]));
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const relevant = (tasks || []).filter((t) => new Date(t.due_at).getTime() <= endOfToday.getTime());

    if (relevant.length === 0) {
      return dispatchToEvolution({
        phone: senderPhone,
        text: `✅ Nenhuma tarefa pendente para hoje ou atrasada!`,
      });
    }

    const lines = [`📅 *Tarefas de hoje e atrasadas (${relevant.length}):*`, ``];
    for (const t of relevant.slice(0, 15)) {
      const lead = leadMap.get(t.lead_id);
      const isOverdue = new Date(t.due_at).getTime() < now.getTime();
      lines.push(
        `${isOverdue ? '🔴' : '🔵'} *${lead?.name || 'Lead'}* — ${t.title}\n   🕒 ${formatDateBr(t.due_at)}${isOverdue ? ' (atrasada)' : ''}`
      );
    }

    return dispatchToEvolution({ phone: senderPhone, text: lines.join('\n') });
  }

  // 5. Parados (+2 dias)
  if (norm === 'parados' || norm === 'parado') {
    const stale = (leads || []).filter((l) => {
      const slug = stageMap.get(l.stage_id)?.slug || '';
      return slug !== 'ganho' && slug !== 'perdido' && daysInactive(l.last_activity_at) >= 2;
    });

    if (stale.length === 0) {
      return dispatchToEvolution({
        phone: senderPhone,
        text: `✅ Nenhum lead parado há mais de 2 dias!`,
      });
    }

    const lines = [`⏰ *Leads parados (+2 dias) — ${stale.length}:*`, ``];
    for (const l of stale.slice(0, 15)) {
      const st = stageMap.get(l.stage_id)?.name || '';
      const d = daysInactive(l.last_activity_at);
      lines.push(`${d >= 3 ? '🔴' : '🟡'} *${l.name}* (${d}d)\n   ${st} · ${formatPhoneBr(l.phone)}`);
    }

    return dispatchToEvolution({ phone: senderPhone, text: lines.join('\n') });
  }

  // 6. Novos leads
  if (norm === 'novos' || norm === 'novo') {
    const fresh = (leads || []).filter((l) => {
      const slug = stageMap.get(l.stage_id)?.slug || '';
      return slug === 'contato-novo' || l.is_returning;
    });

    if (fresh.length === 0) {
      return dispatchToEvolution({
        phone: senderPhone,
        text: `Nenhum lead em *Contato novo* no momento.`,
      });
    }

    const lines = [`🆕 *Contato novo / Novo interesse (${fresh.length}):*`, ``];
    for (const l of fresh.slice(0, 12)) {
      const badge = l.is_returning ? ' ✨Novo interesse' : '';
      lines.push(`• *${l.name}*${badge}\n  ${formatPhoneBr(l.phone)} · ${l.source || 'manual'}`);
    }

    return dispatchToEvolution({ phone: senderPhone, text: lines.join('\n') });
  }

  // 7. Busca por nome ou telefone (@crm buscar <termo> ou atalho @crm <termo>)
  const query = afterPrefix.replace(/^buscar\s+/i, '').trim();
  const qNorm = normalizeText(query);
  const qDigits = onlyDigits(query);

  const matches = (leads || []).filter((l) => {
    const byName = qNorm && normalizeText(l.name).includes(qNorm);
    const byPhone = qDigits.length >= 4 && l.phone.includes(qDigits);
    return byName || byPhone;
  });

  if (matches.length === 0) {
    return dispatchToEvolution({
      phone: senderPhone,
      text: `🔎 Nenhum lead encontrado para *"${query}"*.\nDigite *@crm ajuda* para ver todos os comandos.`,
    });
  }

  if (matches.length === 1) {
    const lead = matches[0];
    const stageName = stageMap.get(lead.stage_id)?.name || '-';
    const tagNames = (lead.lead_tags || []).map((lt) => lt.tags?.name).filter(Boolean);
    const [notes, leadTasks] = await Promise.all([
      supabaseRest(`lead_notes?lead_id=eq.${lead.id}&select=*&order=created_at.desc&limit=3`),
      supabaseRest(`tasks?lead_id=eq.${lead.id}&completed=eq.false&select=*&order=due_at.asc&limit=3`),
    ]);

    const lines = [
      `👤 *${lead.name}*`,
      `📱 ${formatPhoneBr(lead.phone)}${lead.has_whatsapp ? '' : ' (Sem WhatsApp)'}`,
      `📌 *Etapa:* ${stageName}${stageMap.get(lead.stage_id)?.slug === 'ganho' ? ` (${lead.enrollment_status})` : ''}`,
      `🌐 *Origem:* ${lead.source || 'manual'}`,
    ];
    if (tagNames.length > 0) lines.push(`🏷️ *Tags:* ${tagNames.join(', ')}`);
    if (lead.loss_reason) lines.push(`❌ *Motivo da perda:* ${lead.loss_reason}`);
    lines.push(`🕒 *Última atividade:* ${formatDateBr(lead.last_activity_at)}`);

    if (notes && notes.length > 0) {
      lines.push(``, `📝 *Últimas anotações:*`);
      for (const n of notes) {
        lines.push(`• ${n.author_name} (${formatDateBr(n.created_at)}): ${n.content}`);
      }
    }

    if (leadTasks && leadTasks.length > 0) {
      lines.push(``, `📅 *Próximas tarefas:*`);
      for (const t of leadTasks) {
        lines.push(`• ${t.title} (${formatDateBr(t.due_at)})`);
      }
    }

    return dispatchToEvolution({ phone: senderPhone, text: lines.join('\n') });
  }

  const lines = [`🔎 *${matches.length} leads encontrados para "${query}":*`, ``];
  for (const l of matches.slice(0, 10)) {
    const st = stageMap.get(l.stage_id)?.name || '';
    lines.push(`• *${l.name}* — ${st}\n  ${formatPhoneBr(l.phone)} · ${l.source || 'manual'}`);
  }
  return dispatchToEvolution({ phone: senderPhone, text: lines.join('\n') });
}

async function handleEvolutionWebhook(body) {
  const event = String(body?.event || '').toLowerCase();

  // 0. Atualização de status da conexão WhatsApp (CONNECTION_UPDATE)
  if (event.includes('connection.update') || event === 'connection_update') {
    const incomingInstance = String(body?.instance || body?.data?.instance || '').trim();
    const rawState = body?.data?.state || body?.state || '';
    const mappedStatus = mapConnectionState(rawState);
    const activeRow = await getWhatsAppSettingsRow();
    if (
      activeRow &&
      incomingInstance &&
      activeRow.instance_name === incomingInstance &&
      activeRow.status !== mappedStatus
    ) {
      await supabaseRest('whatsapp_settings?id=eq.true', {
        method: 'PATCH',
        body: { status: mappedStatus },
      }).catch(() => {});
    }
    return;
  }

  // 1. Atualização de status de mensagens enviadas (delivered, read, error)
  if (event.includes('messages.update') || event === 'messages_update') {
    const items = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : [];
    for (const item of items) {
      const evoId = item?.key?.id || item?.keyId || item?.id;
      const mapped = mapEvolutionStatus(item?.status ?? item?.update?.status);
      if (evoId && mapped && SUPABASE_SERVICE_ROLE_KEY) {
        await Promise.all([
          supabaseRest(`message_logs?evolution_message_id=eq.${encodeURIComponent(evoId)}`, {
            method: 'PATCH',
            body: { status: mapped },
          }).catch(() => {}),
          supabaseRest(`chat_messages?evolution_message_id=eq.${encodeURIComponent(evoId)}`, {
            method: 'PATCH',
            body: { status: mapped },
          }).catch(() => {}),
        ]);
      }
    }
    return;
  }

  // 2. Mensagens recebidas e enviadas (Sincronia total + comandos @crm + vCard)
  if (event.includes('messages.upsert') || event === 'messages_upsert') {
    const data = body?.data;
    if (!data) return;

    const remoteJid = String(data?.key?.remoteJid || '');
    // Escopo enxuto: ignora grupos (@g.us) e status/broadcasts
    if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.includes('status@broadcast')) return;

    const msgId = data?.key?.id;
    if (markMessageProcessed(msgId)) return;

    const fromMe = Boolean(data?.key?.fromMe);
    const contactPhone = onlyDigits(remoteJid.split('@')[0]);
    if (!contactPhone) return;

    const text = extractMessageText(data?.message);
    const sharedContacts = extractSharedContacts(data?.message);

    // 2A. Comandos @crm ou vCard enviados por membro autorizado da equipe (somente inbound)
    if (!fromMe) {
      const isCrmCommand = /^@crm\b/i.test(text);
      if (isCrmCommand || sharedContacts.length > 0) {
        const profile = await findAuthorizedProfile(contactPhone);
        if (profile) {
          if (sharedContacts.length > 0) {
            await handleSharedContacts(sharedContacts, contactPhone, profile);
            return;
          }
          if (isCrmCommand) {
            await handleCrmCommand(text, contactPhone, profile);
            return;
          }
        }
      }
    }

    // 2B. Conversa individual normal (inbound do lead ou outbound pelo celular físico)
    const parsed = parseIncomingWhatsAppMessage(data?.message);
    if (!parsed) return;

    const lead = await findOrCreateLeadForChat(contactPhone, data?.pushName, !fromMe);
    if (!lead) return;

    const evolutionKey = {
      id: msgId || undefined,
      remoteJid,
      fromMe,
    };

    await supabaseRest('chat_messages', {
      method: 'POST',
      prefer: 'resolution=ignore-duplicates',
      body: {
        lead_id: lead.id,
        evolution_message_id: msgId || null,
        direction: fromMe ? 'outbound' : 'inbound',
        message_type: parsed.messageType,
        body: parsed.body || '',
        media_url: null, // Zero base64 salvo no banco — mídia carregada sob demanda!
        media_mime: parsed.mediaMime,
        media_file_name: parsed.mediaFileName,
        evolution_key: parsed.messageType !== 'text' ? evolutionKey : null,
        status: fromMe ? 'sent' : 'delivered',
        sent_by: fromMe ? 'Celular' : null,
      },
    }).catch((err) => console.warn('[CHAT UPSERT WARN]', err.message));
  }
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  try {
    // 1. Healthcheck
    if (req.method === 'GET' && urlPath === '/api/health') {
      const activeInstance = await getActiveInstanceName();
      return sendJson(res, 200, {
        ok: true,
        service: 'hp-academy-crm',
        evolutionConfigured: Boolean(EVOLUTION_API_KEY),
        activeInstance,
      });
    }

    // 1.1. Gestão da Instância WhatsApp: Consultar status atual
    if (req.method === 'GET' && urlPath === '/api/whatsapp/status') {
      const user = await verifySupabaseJwt(req);
      if (!user) return sendJson(res, 401, { error: 'Não autorizado' });

      const row = await getWhatsAppSettingsRow();
      if (!row) {
        return sendJson(res, 200, {
          configured: false,
          instance_name: '',
          phone: '',
          status: 'disconnected',
          updated_at: null,
        });
      }

      let liveStatus = row.status;
      try {
        const stateRes = await evolutionRequest(
          `/instance/connectionState/${encodeURIComponent(row.instance_name)}`
        );
        if (stateRes.ok) {
          const rawState = stateRes.data?.instance?.state || stateRes.data?.state;
          liveStatus = mapConnectionState(rawState);
        } else if (stateRes.status === 404) {
          liveStatus = 'disconnected';
        }
      } catch {
        // Mantém último status conhecido se a Evolution oscilar momentaneamente
      }

      if (liveStatus !== row.status) {
        await supabaseRest('whatsapp_settings?id=eq.true', {
          method: 'PATCH',
          body: { status: liveStatus },
        }).catch(() => {});
      }

      return sendJson(res, 200, {
        configured: true,
        instance_name: row.instance_name,
        phone: row.phone,
        status: liveStatus,
        updated_at: new Date().toISOString(),
      });
    }

    // 1.2. Gestão da Instância WhatsApp: Gerar novo QR Code para reconectar instância ativa
    if (req.method === 'POST' && urlPath === '/api/whatsapp/reconnect') {
      const user = await verifySupabaseJwt(req);
      if (!user) return sendJson(res, 401, { error: 'Não autorizado' });

      const row = await getWhatsAppSettingsRow();
      if (!row?.instance_name) {
        return sendJson(res, 404, { error: 'Nenhuma instância configurada. Cadastre um número primeiro.' });
      }

      // Verifica se já está conectado antes de pedir QR Code
      const stateCheck = await evolutionRequest(
        `/instance/connectionState/${encodeURIComponent(row.instance_name)}`
      );
      if (stateCheck.ok && mapConnectionState(stateCheck.data?.instance?.state || stateCheck.data?.state) === 'connected') {
        await supabaseRest('whatsapp_settings?id=eq.true', {
          method: 'PATCH',
          body: { status: 'connected' },
        }).catch(() => {});
        return sendJson(res, 200, { alreadyConnected: true, status: 'connected' });
      }

      const connectRes = await evolutionRequest(
        `/instance/connect/${encodeURIComponent(row.instance_name)}`
      );
      if (!connectRes.ok) {
        return sendJson(res, 502, {
          error: `Não foi possível gerar QR Code (${connectRes.status}): ${connectRes.rawText.slice(0, 200)}`,
        });
      }

      const { qrcode, pairingCode } = extractQrCodeData(connectRes.data);
      if (!qrcode) {
        return sendJson(res, 502, {
          error: 'A Evolution API não retornou a imagem do QR Code. Tente novamente em alguns segundos.',
        });
      }

      await supabaseRest('whatsapp_settings?id=eq.true', {
        method: 'PATCH',
        body: { status: 'connecting' },
      }).catch(() => {});

      return sendJson(res, 200, {
        alreadyConnected: false,
        status: 'connecting',
        qrcode,
        pairingCode,
      });
    }

    // 1.3. Gestão da Instância WhatsApp: Criar nova instância (substituindo a anterior)
    if (req.method === 'POST' && urlPath === '/api/whatsapp/instance') {
      const user = await verifySupabaseJwt(req);
      if (!user) return sendJson(res, 401, { error: 'Não autorizado' });

      const body = await readJsonBody(req);
      const instanceName = sanitizeInstanceName(body.instanceName || body.instance_name);
      const cleanPhone = normalizePhoneBr(body.phone);

      if (!instanceName || instanceName.length < 3) {
        return sendJson(res, 400, {
          error: 'Informe um nome de instância válido (mínimo 3 caracteres, sem espaços ou acentos).',
        });
      }
      if (!cleanPhone.startsWith('55') || (cleanPhone.length !== 12 && cleanPhone.length !== 13)) {
        return sendJson(res, 400, {
          error: 'Informe um número de WhatsApp válido com DDD (ex: (81) 99999-9999).',
        });
      }

      const previous = await getWhatsAppSettingsRow();

      // Remove a instância anterior na Evolution API (preservando instâncias compartilhadas protegidas)
      if (
        previous?.instance_name &&
        previous.instance_name !== instanceName &&
        !PROTECTED_INSTANCES.has(previous.instance_name.toLowerCase())
      ) {
        await evolutionRequest(`/instance/logout/${encodeURIComponent(previous.instance_name)}`, {
          method: 'DELETE',
        }).catch(() => {});
        await evolutionRequest(`/instance/delete/${encodeURIComponent(previous.instance_name)}`, {
          method: 'DELETE',
        }).catch(() => {});
      }

      // Cria a nova instância na Evolution API já com o webhook do CRM
      const webhookUrl = `${CRM_PUBLIC_URL}/api/webhooks/evolution`;
      const createRes = await evolutionRequest('/instance/create', {
        method: 'POST',
        body: {
          instanceName,
          number: cleanPhone,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
          webhook: {
            url: webhookUrl,
            byEvents: false,
            base64: false,
            events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
          },
        },
      });

      let qrPayload = extractQrCodeData(createRes.data);

      // Se a instância já existia (403/409) ou não devolveu QR na criação, garante webhook e puxa /connect
      if (!createRes.ok && createRes.status !== 403 && createRes.status !== 409) {
        return sendJson(res, 502, {
          error: `Erro ao criar instância na Evolution API (${createRes.status}): ${createRes.rawText.slice(0, 220)}`,
        });
      }

      // Garante que o webhook está ativo na nova instância
      await evolutionRequest(`/webhook/set/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        body: {
          webhook: {
            enabled: true,
            url: webhookUrl,
            webhookByEvents: false,
            webhookBase64: false,
            events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
          },
        },
      }).catch(() => {});

      if (!qrPayload.qrcode) {
        const connectRes = await evolutionRequest(
          `/instance/connect/${encodeURIComponent(instanceName)}`
        );
        if (connectRes.ok) {
          qrPayload = extractQrCodeData(connectRes.data);
        }
      }

      // Persiste como única instância ativa (singleton id = true)
      await supabaseRest('whatsapp_settings', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates',
        body: {
          id: true,
          instance_name: instanceName,
          phone: cleanPhone,
          status: 'connecting',
        },
      });

      invalidateActiveInstanceCache();

      return sendJson(res, 200, {
        configured: true,
        instance_name: instanceName,
        phone: cleanPhone,
        status: 'connecting',
        qrcode: qrPayload.qrcode,
        pairingCode: qrPayload.pairingCode,
      });
    }

    // 2. Envio individual autenticado
    if (req.method === 'POST' && urlPath === '/api/messages/send') {
      const user = await verifySupabaseJwt(req);
      if (!user) return sendJson(res, 401, { error: 'Não autorizado' });

      const body = await readJsonBody(req);
      const { message_log_id, lead_id, phone, text, media_url, file_name, file_type, sent_by } = body;
      if (!phone) return sendJson(res, 400, { error: 'Telefone obrigatório' });

      try {
        const result = await dispatchToEvolution({
          phone,
          text,
          mediaUrl: media_url,
          fileName: file_name,
          fileType: file_type,
        });

        if (message_log_id && SUPABASE_SERVICE_ROLE_KEY) {
          await supabaseRest(`message_logs?id=eq.${encodeURIComponent(message_log_id)}`, {
            method: 'PATCH',
            body: {
              status: 'sent',
              evolution_message_id: result.evolutionMessageId,
            },
          });
        }

        if (lead_id) {
          await recordOutboundChatMessage({
            leadId: lead_id,
            evolutionMessageId: result.evolutionMessageId,
            messageType: media_url ? inferMessageType(file_type, file_name) : 'text',
            body: text || '',
            mediaUrl: media_url || null,
            mediaMime: file_type || null,
            mediaFileName: file_name || null,
            sentBy: sent_by || user.user_metadata?.full_name || 'Equipe HP',
          });
        }

        return sendJson(res, 200, {
          ok: true,
          evolution_message_id: result.evolutionMessageId,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'Erro na Evolution API';
        if (message_log_id && SUPABASE_SERVICE_ROLE_KEY) {
          await supabaseRest(`message_logs?id=eq.${encodeURIComponent(message_log_id)}`, {
            method: 'PATCH',
            body: { status: 'error', error_detail: detail.slice(0, 500) },
          }).catch(() => {});
        }
        return sendJson(res, 502, { ok: false, error: detail });
      }
    }

    // 3. Disparo em massa autenticado
    if (req.method === 'POST' && urlPath === '/api/messages/bulk') {
      const user = await verifySupabaseJwt(req);
      if (!user) return sendJson(res, 401, { error: 'Não autorizado' });

      const body = await readJsonBody(req);
      const leadIds = Array.isArray(body.lead_ids) ? body.lead_ids : [];
      if (leadIds.length === 0) {
        return sendJson(res, 400, { error: 'Nenhum lead selecionado' });
      }

      processBulkQueue({
        leadIds,
        templateId: body.template_id || null,
        customMessage: body.custom_message || '',
        sentBy: body.sent_by || user.user_metadata?.full_name || 'Equipe HP',
      });

      return sendJson(res, 202, { ok: true, queued: leadIds.length });
    }

    // 3.1. Chat: Enviar texto ou anexo/material da Biblioteca
    if (req.method === 'POST' && urlPath === '/api/chat/send') {
      const user = await verifySupabaseJwt(req);
      if (!user) return sendJson(res, 401, { error: 'Não autorizado' });

      const body = await readJsonBody(req);
      const { lead_id, phone, text, media_url, file_name, file_type, sent_by } = body;
      if (!lead_id || !phone) {
        return sendJson(res, 400, { error: 'lead_id e phone são obrigatórios' });
      }
      if (!String(text || '').trim() && !media_url) {
        return sendJson(res, 400, { error: 'Informe uma mensagem ou anexo.' });
      }

      const result = await dispatchToEvolution({
        phone,
        text: text || '',
        mediaUrl: media_url || null,
        fileName: file_name || null,
        fileType: file_type || null,
      });

      const saved = await recordOutboundChatMessage({
        leadId: lead_id,
        evolutionMessageId: result.evolutionMessageId,
        messageType: media_url ? inferMessageType(file_type, file_name) : 'text',
        body: text || '',
        mediaUrl: media_url || null,
        mediaMime: file_type || null,
        mediaFileName: file_name || null,
        sentBy: sent_by || user.user_metadata?.full_name || 'Equipe HP',
      });

      return sendJson(res, 200, { ok: true, message: saved });
    }

    // 3.2. Chat: Enviar áudio gravado pelo navegador (sem salvar base64 no Postgres)
    if (req.method === 'POST' && urlPath === '/api/chat/send-audio') {
      const user = await verifySupabaseJwt(req);
      if (!user) return sendJson(res, 401, { error: 'Não autorizado' });

      const body = await readJsonBody(req, 15_000_000);
      const { lead_id, phone, audio_base64, mime_type, sent_by } = body;
      if (!lead_id || !phone || !audio_base64) {
        return sendJson(res, 400, { error: 'lead_id, phone e audio_base64 são obrigatórios' });
      }

      const result = await dispatchAudioToEvolution({ phone, audioBase64: audio_base64 });

      const saved = await recordOutboundChatMessage({
        leadId: lead_id,
        evolutionMessageId: result.evolutionMessageId,
        messageType: 'audio',
        body: '',
        mediaUrl: null,
        mediaMime: mime_type || 'audio/ogg',
        mediaFileName: 'audio.ogg',
        evolutionKey: result.key || null,
        sentBy: sent_by || user.user_metadata?.full_name || 'Equipe HP',
      });

      return sendJson(res, 200, { ok: true, message: saved });
    }

    // 3.3. Chat: Carregar/baixar mídia sob demanda direto da Evolution API (zero base64 no banco)
    if (req.method === 'GET' && urlPath.startsWith('/api/chat/media/')) {
      const user = await verifySupabaseJwt(req);
      if (!user) return sendJson(res, 401, { error: 'Não autorizado' });

      const messageId = decodeURIComponent(urlPath.slice('/api/chat/media/'.length));
      if (!messageId) return sendJson(res, 400, { error: 'ID inválido' });

      const rows = await supabaseRest(
        `chat_messages?id=eq.${encodeURIComponent(messageId)}&select=id,media_url,media_mime,media_file_name,evolution_key`
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return sendJson(res, 404, { error: 'Mensagem não encontrada' });

      if (row.media_url) {
        const proxyRes = await fetch(row.media_url);
        if (!proxyRes.ok) return sendJson(res, 502, { error: 'Erro ao baixar anexo' });
        const buf = Buffer.from(await proxyRes.arrayBuffer());
        res.writeHead(200, {
          'Content-Type': row.media_mime || proxyRes.headers.get('content-type') || 'application/octet-stream',
          'Cache-Control': 'private, max-age=3600',
        });
        return res.end(buf);
      }

      if (!row.evolution_key) {
        return sendJson(res, 404, { error: 'Mídia não disponível para download sob demanda.' });
      }

      const activeInstance = await getActiveInstanceName();
      const evoRes = await evolutionRequest(
        `/chat/getBase64FromMediaMessage/${encodeURIComponent(activeInstance)}`,
        {
          method: 'POST',
          body: {
            message: { key: row.evolution_key },
            convertToMp4: false,
          },
        }
      );

      const base64Str = evoRes.data?.base64 || evoRes.data?.data?.base64;
      if (!evoRes.ok || !base64Str) {
        return sendJson(res, 502, {
          error: 'A Evolution API não conseguiu recuperar esta mídia (pode ter expirado no WhatsApp).',
        });
      }

      const cleanedB64 = String(base64Str).replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(cleanedB64, 'base64');
      const mimeType = evoRes.data?.mimetype || row.media_mime || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': buffer.length,
        'Cache-Control': 'private, max-age=1800',
      });
      return res.end(buffer);
    }

    // 4. Webhook da Evolution API (MESSAGES_UPDATE + MESSAGES_UPSERT @crm e vCard)
    if (req.method === 'POST' && urlPath === '/api/webhooks/evolution') {
      const body = await readJsonBody(req, 500_000);
      // Responde 200 imediatamente e processa de forma assíncrona para evitar timeout na Evolution
      sendJson(res, 200, { ok: true });
      handleEvolutionWebhook(body).catch((err) => console.error('[EVO WEBHOOK ERROR]', err));
      return;
    }

    // 5. Webhook de entrada de leads do site hpacademy.com.br
    if (req.method === 'POST' && urlPath === '/api/webhooks/lead') {
      if (CRM_WEBHOOK_SECRET) {
        const provided = req.headers['x-webhook-secret'] || '';
        if (provided !== CRM_WEBHOOK_SECRET) {
          return sendJson(res, 401, { error: 'Segredo inválido' });
        }
      }

      const body = await readJsonBody(req);
      const nome = String(body.nome || body.name || '').trim();
      const telefone = String(body.telefone || body.phone || '').trim();
      const origem = String(body.origem || body.source || 'site').trim();
      const tags = Array.isArray(body.tags) ? body.tags : [];

      if (!nome || onlyDigits(telefone).length < 10) {
        return sendJson(res, 400, { error: 'Nome e telefone válidos são obrigatórios' });
      }

      const lead = await supabaseRest('rpc/upsert_incoming_lead', {
        method: 'POST',
        body: { p_name: nome, p_phone: telefone, p_source: origem, p_tags: tags },
      });

      return sendJson(res, 200, { ok: true, lead });
    }

    // 6. Arquivos estáticos + SPA fallback
    const safeRel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    let filePath = path.resolve(DIST_DIR, safeRel);
    if (!filePath.startsWith(DIST_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const isHashedAsset = urlPath.startsWith('/assets/');
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': isHashedAsset ? 'public, max-age=2592000, immutable' : 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('[SERVER ERROR]', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : 'Erro interno' });
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`HP Academy CRM rodando na porta ${PORT}`);
});
