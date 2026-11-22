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
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'evaflow';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const CRM_WEBHOOK_SECRET = process.env.CRM_WEBHOOK_SECRET || '';

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

async function dispatchToEvolution({ phone, text, mediaUrl, fileName, fileType }) {
  if (!EVOLUTION_API_URL || !EVOLUTION_INSTANCE || !EVOLUTION_API_KEY) {
    throw new Error('Evolution API não configurada no servidor (EVOLUTION_API_KEY ausente).');
  }

  const cleanNumber = onlyDigits(phone);
  let endpoint = `${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`;
  let payload;

  if (mediaUrl) {
    endpoint = `${EVOLUTION_API_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`;
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

  // 1. Atualização de status de mensagens enviadas (delivered, read, error)
  if (event.includes('messages.update') || event === 'messages_update') {
    const items = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : [];
    for (const item of items) {
      const evoId = item?.key?.id || item?.keyId || item?.id;
      const mapped = mapEvolutionStatus(item?.status ?? item?.update?.status);
      if (evoId && mapped && SUPABASE_SERVICE_ROLE_KEY) {
        await supabaseRest(`message_logs?evolution_message_id=eq.${encodeURIComponent(evoId)}`, {
          method: 'PATCH',
          body: { status: mapped },
        }).catch(() => {});
      }
    }
    return;
  }

  // 2. Mensagens recebidas (comandos @crm ou contatos compartilhados)
  if (event.includes('messages.upsert') || event === 'messages_upsert') {
    const data = body?.data;
    if (!data) return;

    // Ignora mensagens enviadas pela própria instância e mensagens de grupos
    if (data?.key?.fromMe) return;
    const remoteJid = String(data?.key?.remoteJid || '');
    if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.includes('status@broadcast')) return;

    const msgId = data?.key?.id;
    if (markMessageProcessed(msgId)) return;

    const senderPhone = onlyDigits(remoteJid.split('@')[0]);
    const text = extractMessageText(data?.message);
    const sharedContacts = extractSharedContacts(data?.message);

    const isCrmCommand = /^@crm\b/i.test(text);
    if (!isCrmCommand && sharedContacts.length === 0) return;

    // Trava de segurança: só responde aos telefones autorizados em crm.profiles
    const profile = await findAuthorizedProfile(senderPhone);
    if (!profile) return;

    if (sharedContacts.length > 0) {
      await handleSharedContacts(sharedContacts, senderPhone, profile);
      return;
    }

    if (isCrmCommand) {
      await handleCrmCommand(text, senderPhone, profile);
    }
  }
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  try {
    // 1. Healthcheck
    if (req.method === 'GET' && urlPath === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'hp-academy-crm',
        evolutionConfigured: Boolean(EVOLUTION_API_KEY),
      });
    }

    // 2. Envio individual autenticado
    if (req.method === 'POST' && urlPath === '/api/messages/send') {
      const user = await verifySupabaseJwt(req);
      if (!user) return sendJson(res, 401, { error: 'Não autorizado' });

      const body = await readJsonBody(req);
      const { message_log_id, phone, text, media_url, file_name, file_type } = body;
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
