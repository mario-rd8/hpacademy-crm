-- =============================================================================
-- HP Academy CRM — Schema Declarativo (BD-Perfect)
-- Schema alvo: crm (Supabase self-hosted em https://supabase.evaflow.com.br)
--
-- IMPORTANTE (PostgREST):
-- Certifique-se de que a variável PGRST_DB_SCHEMAS no Supabase inclua `crm`:
--   PGRST_DB_SCHEMAS=public,storage,graphql_public,crm
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS crm;

-- Permissões de uso do schema para roles do Supabase
GRANT USAGE ON SCHEMA crm TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA crm TO authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA crm TO authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA crm TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA crm
  GRANT ALL ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA crm
  GRANT ALL ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA crm
  GRANT ALL ON FUNCTIONS TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1. Perfis das atendentes (vinculados ao auth.users)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'atendente',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. Colunas do Kanban (crm.stages)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#012d63',
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_stages_position ON crm.stages(position);

-- -----------------------------------------------------------------------------
-- 3. Leads (crm.leads)
-- Telefone salvo sempre limpo com DDI (ex: 5581999999999)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  stage_id UUID NOT NULL REFERENCES crm.stages(id) ON DELETE RESTRICT,
  source TEXT NOT NULL DEFAULT 'manual',
  loss_reason TEXT,
  enrollment_status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (enrollment_status IN ('pendente', 'matriculado')),
  has_whatsapp BOOLEAN NOT NULL DEFAULT true,
  is_returning BOOLEAN NOT NULL DEFAULT false,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm.leads(stage_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_last_activity ON crm.leads(last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_leads_phone ON crm.leads(phone);

-- -----------------------------------------------------------------------------
-- 4. Tags e Relação N:N (crm.tags, crm.lead_tags)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  color TEXT NOT NULL DEFAULT '#012d63',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm.lead_tags (
  lead_id UUID NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES crm.tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_tags_tag ON crm.lead_tags(tag_id);

-- -----------------------------------------------------------------------------
-- 5. Anotações / Timeline (crm.lead_notes)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.lead_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_notes_lead ON crm.lead_notes(lead_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 6. Tarefas e Follow-ups (crm.tasks)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_lead ON crm.tasks(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_due ON crm.tasks(completed, due_at);

-- -----------------------------------------------------------------------------
-- 7. Biblioteca de Materiais / Templates (crm.media_templates)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.media_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  file_url TEXT,
  file_name TEXT,
  file_type TEXT,
  storage_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 8. Histórico de Disparos Evolution API (crm.message_logs)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.message_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  template_id UUID REFERENCES crm.media_templates(id) ON DELETE SET NULL,
  message_body TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  evolution_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'error')),
  error_detail TEXT,
  sent_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_message_logs_lead ON crm.message_logs(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_message_logs_evo_id ON crm.message_logs(evolution_message_id);

-- -----------------------------------------------------------------------------
-- 9. Motivos de Perda Padrão (crm.loss_reasons)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.loss_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT UNIQUE NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 9.1. Configuração da Instância WhatsApp Ativa (Singleton: 1 por vez)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.whatsapp_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  instance_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'disconnected', 'connecting')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 10. Triggers Automáticos (last_activity_at e updated_at)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_crm_leads_updated_at ON crm.leads;
CREATE TRIGGER trg_crm_leads_updated_at
  BEFORE UPDATE ON crm.leads
  FOR EACH ROW EXECUTE FUNCTION crm.touch_updated_at();

DROP TRIGGER IF EXISTS trg_crm_media_templates_updated_at ON crm.media_templates;
CREATE TRIGGER trg_crm_media_templates_updated_at
  BEFORE UPDATE ON crm.media_templates
  FOR EACH ROW EXECUTE FUNCTION crm.touch_updated_at();

DROP TRIGGER IF EXISTS trg_crm_message_logs_updated_at ON crm.message_logs;
CREATE TRIGGER trg_crm_message_logs_updated_at
  BEFORE UPDATE ON crm.message_logs
  FOR EACH ROW EXECUTE FUNCTION crm.touch_updated_at();

-- Atualiza last_activity_at do lead quando uma nota, tarefa ou mensagem é criada
CREATE OR REPLACE FUNCTION crm.bump_lead_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE crm.leads
  SET last_activity_at = now()
  WHERE id = NEW.lead_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_crm_notes_bump_activity ON crm.lead_notes;
CREATE TRIGGER trg_crm_notes_bump_activity
  AFTER INSERT ON crm.lead_notes
  FOR EACH ROW EXECUTE FUNCTION crm.bump_lead_activity();

DROP TRIGGER IF EXISTS trg_crm_tasks_bump_activity ON crm.tasks;
CREATE TRIGGER trg_crm_tasks_bump_activity
  AFTER INSERT OR UPDATE ON crm.tasks
  FOR EACH ROW EXECUTE FUNCTION crm.bump_lead_activity();

DROP TRIGGER IF EXISTS trg_crm_messages_bump_activity ON crm.message_logs;
CREATE TRIGGER trg_crm_messages_bump_activity
  AFTER INSERT ON crm.message_logs
  FOR EACH ROW EXECUTE FUNCTION crm.bump_lead_activity();

-- -----------------------------------------------------------------------------
-- 11. RPC para Entrada de Leads pelo Site HP Academy (Webhook)
-- Identifica pelo telefone normalizado: se já existe, marca is_returning = true
-- e atualiza last_activity_at; caso contrário cria na coluna 'contato-novo'.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm.upsert_incoming_lead(
  p_name TEXT,
  p_phone TEXT,
  p_source TEXT DEFAULT 'site',
  p_tags TEXT[] DEFAULT '{}'
)
RETURNS crm.leads
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_clean_phone TEXT;
  v_lead crm.leads;
  v_default_stage_id UUID;
  v_tag_name TEXT;
  v_tag_id UUID;
BEGIN
  v_clean_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  IF length(v_clean_phone) IN (10, 11) THEN
    v_clean_phone := '55' || v_clean_phone;
  END IF;

  IF length(v_clean_phone) < 12 THEN
    RAISE EXCEPTION 'Telefone inválido: %', p_phone;
  END IF;

  SELECT * INTO v_lead FROM crm.leads WHERE phone = v_clean_phone;

  IF FOUND THEN
    UPDATE crm.leads
    SET
      is_returning = true,
      last_activity_at = now(),
      source = COALESCE(NULLIF(p_source, ''), source)
    WHERE id = v_lead.id
    RETURNING * INTO v_lead;
  ELSE
    SELECT id INTO v_default_stage_id
    FROM crm.stages
    ORDER BY position ASC
    LIMIT 1;

    INSERT INTO crm.leads (name, phone, stage_id, source, is_returning, last_activity_at)
    VALUES (trim(p_name), v_clean_phone, v_default_stage_id, COALESCE(NULLIF(p_source, ''), 'site'), false, now())
    RETURNING * INTO v_lead;
  END IF;

  IF p_tags IS NOT NULL THEN
    FOREACH v_tag_name IN ARRAY p_tags LOOP
      SELECT id INTO v_tag_id FROM crm.tags WHERE lower(name) = lower(trim(v_tag_name));
      IF FOUND THEN
        INSERT INTO crm.lead_tags (lead_id, tag_id)
        VALUES (v_lead.id, v_tag_id)
        ON CONFLICT (lead_id, tag_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN v_lead;
END;
$$;

-- -----------------------------------------------------------------------------
-- 12. Row Level Security (RLS) — Obrigatório em todas as tabelas (BD-Perfect)
-- -----------------------------------------------------------------------------
ALTER TABLE crm.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.media_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.message_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.loss_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.whatsapp_settings ENABLE ROW LEVEL SECURITY;

-- Policies para usuários autenticados (equipe comercial HP Academy)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'profiles', 'stages', 'leads', 'tags', 'lead_tags',
    'lead_notes', 'tasks', 'media_templates', 'message_logs', 'loss_reasons', 'whatsapp_settings'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_all_%s" ON crm.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "authenticated_all_%s" ON crm.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      tbl, tbl
    );
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 13. Supabase Storage — Bucket `crm-media` para PNG e PDF
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'crm-media',
  'crm-media',
  true,
  15728640, -- 15 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "crm_media_public_read" ON storage.objects;
CREATE POLICY "crm_media_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'crm-media');

DROP POLICY IF EXISTS "crm_media_auth_insert" ON storage.objects;
CREATE POLICY "crm_media_auth_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'crm-media');

DROP POLICY IF EXISTS "crm_media_auth_update" ON storage.objects;
CREATE POLICY "crm_media_auth_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'crm-media');

DROP POLICY IF EXISTS "crm_media_auth_delete" ON storage.objects;
CREATE POLICY "crm_media_auth_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'crm-media');

-- -----------------------------------------------------------------------------
-- 14. Supabase Realtime — Publicação das tabelas críticas
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['leads', 'message_logs', 'lead_notes', 'tasks', 'stages', 'tags', 'lead_tags'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'crm' AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE crm.%I', tbl);
    END IF;
  END LOOP;
END $$;
