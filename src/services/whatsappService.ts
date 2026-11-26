import { supabase } from './supabaseClient';
import type { WhatsAppConnectionStatus, WhatsAppSettings } from '../types/database.types';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchWhatsAppStatus(): Promise<WhatsAppSettings> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/whatsapp/status', { method: 'GET', headers });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Erro ao consultar status (${res.status})`);
  }
  return data as WhatsAppSettings;
}

export interface QrCodeResponse {
  alreadyConnected?: boolean;
  status: WhatsAppConnectionStatus;
  qrcode?: string | null;
  pairingCode?: string | null;
  instance_name?: string;
  phone?: string;
}

export async function reconnectWhatsAppInstance(): Promise<QrCodeResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/whatsapp/reconnect', { method: 'POST', headers });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Erro ao gerar QR Code (${res.status})`);
  }
  return data as QrCodeResponse;
}

export async function createWhatsAppInstance(params: {
  instanceName: string;
  phone: string;
}): Promise<QrCodeResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/whatsapp/instance', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Erro ao criar instância (${res.status})`);
  }
  return data as QrCodeResponse;
}

export function sanitizeInstanceSlug(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 48);
}
