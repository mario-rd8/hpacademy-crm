import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Validação Rígida (BD-Perfect): falha ruidosa em caso de build mal configurado
if (!supabaseUrl || !supabaseAnonKey) {
  const missing: string[] = [];
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('VITE_SUPABASE_ANON_KEY');

  const errorMsg = `[CRÍTICO - BD-PERFECT] Variáveis de ambiente obrigatórias não encontradas: ${missing.join(', ')}. Verifique seu .env.local ou as variáveis de build (ARG) no Coolify/Docker.`;
  console.error(errorMsg);
  throw new Error(errorMsg);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const crmDb = () => supabase.schema('crm');
