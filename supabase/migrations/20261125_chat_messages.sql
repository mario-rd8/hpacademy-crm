-- =============================================================================
-- Migration: Tela Conversacional (Chat WhatsApp Integrado ao CRM)
-- Zero base64 no banco: mídias recebidas são carregadas sob demanda via Evolution API.
-- =============================================================================

ALTER TABLE crm.leads
  ADD COLUMN IF NOT EXISTS unread_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_message_preview TEXT,
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE INDEX IF NOT EXISTS idx_crm_leads_last_message
  ON crm.leads(last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS crm.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  evolution_message_id TEXT UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'image', 'audio', 'document', 'video')),
  body TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  media_mime TEXT,
  media_file_name TEXT,
  evolution_key JSONB,
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'error')),
  sent_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_chat_messages_lead
  ON crm.chat_messages(lead_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_crm_chat_messages_evo
  ON crm.chat_messages(evolution_message_id);

GRANT ALL ON TABLE crm.chat_messages TO authenticated, service_role;

-- Trigger: atualiza preview, last_message_at, last_activity_at e unread_count no lead
CREATE OR REPLACE FUNCTION crm.sync_lead_on_chat_message()
RETURNS TRIGGER AS $$
DECLARE
  v_preview TEXT;
BEGIN
  v_preview := CASE
    WHEN NEW.message_type = 'image' THEN COALESCE(NULLIF(NEW.body, ''), '📷 Foto')
    WHEN NEW.message_type = 'audio' THEN '🎵 Áudio'
    WHEN NEW.message_type = 'document' THEN '📎 ' || COALESCE(NULLIF(NEW.media_file_name, ''), 'Documento')
    WHEN NEW.message_type = 'video' THEN COALESCE(NULLIF(NEW.body, ''), '🎥 Vídeo')
    ELSE left(NEW.body, 140)
  END;

  UPDATE crm.leads
  SET
    last_activity_at = GREATEST(last_activity_at, NEW.created_at),
    last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at),
    last_message_preview = v_preview,
    unread_count = CASE
      WHEN NEW.direction = 'inbound' THEN unread_count + 1
      ELSE unread_count
    END
  WHERE id = NEW.lead_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_crm_chat_messages_sync_lead ON crm.chat_messages;
CREATE TRIGGER trg_crm_chat_messages_sync_lead
  AFTER INSERT ON crm.chat_messages
  FOR EACH ROW EXECUTE FUNCTION crm.sync_lead_on_chat_message();

ALTER TABLE crm.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_chat_messages" ON crm.chat_messages;
CREATE POLICY "authenticated_all_chat_messages"
  ON crm.chat_messages FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'crm'
      AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE crm.chat_messages;
  END IF;
END $$;
