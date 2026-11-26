-- =============================================================================
-- Migration: Gestão de Instância WhatsApp (Evolution API) — Singleton
-- Garante apenas 1 instância ativa por vez via PRIMARY KEY CHECK (id = true).
-- =============================================================================

CREATE TABLE IF NOT EXISTS crm.whatsapp_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  instance_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'disconnected', 'connecting')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON TABLE crm.whatsapp_settings TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_crm_whatsapp_settings_updated_at ON crm.whatsapp_settings;
CREATE TRIGGER trg_crm_whatsapp_settings_updated_at
  BEFORE UPDATE ON crm.whatsapp_settings
  FOR EACH ROW EXECUTE FUNCTION crm.touch_updated_at();

ALTER TABLE crm.whatsapp_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_whatsapp_settings" ON crm.whatsapp_settings;
CREATE POLICY "authenticated_all_whatsapp_settings"
  ON crm.whatsapp_settings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'crm'
      AND tablename = 'whatsapp_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE crm.whatsapp_settings;
  END IF;
END $$;
