/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_WEBHOOK_SEND_MESSAGE?: string;
  readonly VITE_WEBHOOK_BULK_SEND?: string;
  readonly VITE_EVOLUTION_INSTANCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
