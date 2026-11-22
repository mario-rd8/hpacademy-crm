# HP Academy CRM

Aplicação web minimalista e **Mobile-First** para o CRM comercial da **HP Academy**, construída seguindo a metodologia **BD-Perfect** (Database-First com Supabase, React + TypeScript + Vite + Tailwind CSS v4, Docker/Nginx e Coolify).

- **Domínio de produção:** `https://crm.hpacademy.com.br`
- **Supabase:** `https://supabase.evaflow.com.br` (schema `crm`)
- **Mensageria:** Evolution API (`evo.evaflow.com.br` · instância `evaflow`) via webhooks

---

## 1. Preparação do Banco de Dados (`supabase.evaflow.com.br`)

1. **Expor o schema `crm` no PostgREST:**
   No serviço `supabase` no Coolify, atualize a variável `PGRST_DB_SCHEMAS` para incluir `crm`:
   ```env
   PGRST_DB_SCHEMAS=public,storage,graphql_public,crm
   ```
   *(Requer reinício do serviço Supabase/PostgREST após alteração.)*

2. **Executar o schema e o seed no SQL Editor do Supabase:**
   - Rode [`supabase/schema.sql`](./supabase/schema.sql) (cria schema `crm`, tabelas, triggers, RPC `crm.upsert_incoming_lead`, RLS, Storage bucket `crm-media` e publicação Realtime).
   - Rode [`supabase/seed.sql`](./supabase/seed.sql) (cria colunas iniciais, tags `enem`, `ssa`, `sp`, `F2` e motivos de perda padrão).

3. **Criar os usuários iniciais (Kelma, Mário e Wendel):**
   ```bash
   SUPABASE_URL=https://supabase.evaflow.com.br \
   SUPABASE_SERVICE_ROLE_KEY=SEU_SERVICE_ROLE_KEY \
   INITIAL_USERS_PASSWORD=SENHA_INICIAL_SEGURA \
   npm run seed:users
   ```

---

## 2. Desenvolvimento Local

1. Copie `.env.example` para `.env.local` e preencha as variáveis:
   ```env
   VITE_SUPABASE_URL=https://supabase.evaflow.com.br
   VITE_SUPABASE_ANON_KEY=...
   VITE_WEBHOOK_SEND_MESSAGE=https://...
   VITE_WEBHOOK_BULK_SEND=https://...
   VITE_EVOLUTION_INSTANCE=evaflow
   ```
2. Instale e execute:
   ```bash
   npm install
   npm run dev
   ```

---

## 3. Integrações via Webhooks

- **Disparo individual (`VITE_WEBHOOK_SEND_MESSAGE`):** envia `POST` JSON com `message_log_id`, `instance`, `lead_id`, `lead_name`, `phone`, `text`, `media_url`, `file_name`, `file_type`, `template_id`, `sent_by`. O status do disparo (`sent`, `delivered`, `read`, `error`) é atualizado em `crm.message_logs` e refletido em tempo real na gaveta do card via Supabase Realtime.
- **Disparo em massa (`VITE_WEBHOOK_BULK_SEND`):** envia `POST` JSON com `instance`, `lead_ids`, `template_id`, `custom_message`, `sent_by`.
- **Entrada de leads do site `hpacademy.com.br`:** chamar a RPC `crm.upsert_incoming_lead(p_name, p_phone, p_source, p_tags)` via PostgREST (`Content-Profile: crm`). Se o telefone já existir, o lead existente é marcado com `is_returning = true` e tem `last_activity_at` atualizado automaticamente.
