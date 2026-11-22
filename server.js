/**
 * Servidor de Produção — HP Academy CRM (100% sem n8n)
 * 1. Serve a SPA compilada (dist/) com fallback para index.html
 * 2. POST /api/messages/send      -> Envio individual via Evolution API (chave protegida no servidor)
 * 3. POST /api/messages/bulk      -> Disparo em massa com fila segura e log Realtime no Supabase
 * 4. POST /api/webhooks/evolution -> Recebe status (sent, delivered, read, error) da Evolution API
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

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, limitBytes = 200_000) {
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

function getFirstName(fullName) {
  const first = String(fullName || '').trim().split(/\s+/)[0] || '';
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';
}

function applyTemplateVars(text, leadName) {
  const firstName = getFirstName(leadName);
  return String(text || '').replace(/\{\{\s*nome\s*\}\}/gi, firstName || 'tudo bem');
}

async function dispatchToEvolution({ phone, text, mediaUrl, fileName, fileType }) {
  if (!EVOLUTION_API_URL || !EVOLUTION_INSTANCE || !EVOLUTION_API_KEY) {
    throw new Error('Evolution API não configurada no servidor (EVOLUTION_API_KEY ausente).');
  }

  const cleanNumber = String(phone || '').replace(/\D/g, '');
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

      // Delay anti-bloqueio entre envios (2.5s a 4.5s)
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

    // 3. Disparo em massa autenticado (fila assíncrona no próprio servidor)
    if (req.method === 'POST' && urlPath === '/api/messages/bulk') {
      const user = await verifySupabaseJwt(req);
      if (!user) return sendJson(res, 401, { error: 'Não autorizado' });

      const body = await readJsonBody(req);
      const leadIds = Array.isArray(body.lead_ids) ? body.lead_ids : [];
      if (leadIds.length === 0) {
        return sendJson(res, 400, { error: 'Nenhum lead selecionado' });
      }

      // Dispara em background para resposta imediata ao usuário
      processBulkQueue({
        leadIds,
        templateId: body.template_id || null,
        customMessage: body.custom_message || '',
        sentBy: body.sent_by || user.user_metadata?.full_name || 'Equipe HP',
      });

      return sendJson(res, 202, { ok: true, queued: leadIds.length });
    }

    // 4. Webhook de status da Evolution API (MESSAGES_UPDATE)
    if (req.method === 'POST' && urlPath === '/api/webhooks/evolution') {
      const body = await readJsonBody(req, 500_000);
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

      return sendJson(res, 200, { ok: true });
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

      if (!nome || telefone.replace(/\D/g, '').length < 10) {
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
    sendJson(res, 500, { error: err instanceof Error ? err.message : 'Erro interno' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`HP Academy CRM rodando na porta ${PORT}`);
});
