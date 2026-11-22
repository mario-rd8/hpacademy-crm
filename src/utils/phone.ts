/**
 * Utilitários de telefone, formatação, variáveis de template e WhatsApp inteligente.
 * Padrão do banco: sempre limpo com DDI 55 (ex: 5581999999999).
 * Padrão visual: (81) 99999-9999.
 */

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Remove DDI 55 para exibição/edição com máscara brasileira (DDD + número).
 */
export function stripBrazilDdi(value: string): string {
  const digits = onlyDigits(value);
  if (digits.length >= 12 && digits.startsWith('55')) {
    return digits.slice(2, 13);
  }
  return digits.slice(0, 11);
}

/**
 * Formata para exibição visual: (81) 99999-9999 ou (81) 9999-9999.
 */
export function formatPhoneMask(value: string): string {
  const digits = stripBrazilDdi(value);
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

/**
 * Normaliza para gravação no banco e uso na Evolution API: 5581999999999.
 */
export function normalizePhoneToDb(value: string): string {
  const digits = onlyDigits(value);
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return digits;
  }
  return digits;
}

export function isValidBrPhone(value: string): boolean {
  const dbPhone = normalizePhoneToDb(value);
  return dbPhone.startsWith('55') && (dbPhone.length === 12 || dbPhone.length === 13);
}

/**
 * Converte telefone limpo em e-mail virtual para Supabase Auth sem custo de SMS/OTP.
 */
export function phoneToVirtualEmail(value: string): string {
  return `${normalizePhoneToDb(value)}@hpacademy.crm`;
}

/**
 * Detecta se o dispositivo é mobile e retorna o link ideal do WhatsApp:
 * - Mobile: https://wa.me/{phone}
 * - Desktop: https://web.whatsapp.com/send?phone={phone}
 */
export function getWhatsAppUrl(phone: string, text?: string): string {
  const cleanPhone = normalizePhoneToDb(phone);
  const isMobile =
    typeof navigator !== 'undefined' &&
    (/Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop|Mobile/i.test(navigator.userAgent) ||
      (window.innerWidth <= 768 && 'ontouchstart' in window));

  const encodedText = text ? encodeURIComponent(text) : '';

  if (isMobile) {
    return encodedText
      ? `https://wa.me/${cleanPhone}?text=${encodedText}`
      : `https://wa.me/${cleanPhone}`;
  }

  return encodedText
    ? `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`
    : `https://web.whatsapp.com/send?phone=${cleanPhone}`;
}

/**
 * Extrai o primeiro nome formatado para substituição da variável {{nome}}.
 */
export function getFirstName(fullName: string): string {
  const first = (fullName || '').trim().split(/\s+/)[0] || '';
  if (!first) return '';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export function applyTemplateVariables(template: string, leadName: string): string {
  const firstName = getFirstName(leadName);
  return template.replace(/\{\{\s*nome\s*\}\}/gi, firstName || 'tudo bem');
}

/**
 * Retorna a quantidade de dias inteiros desde a última atividade do lead.
 */
export function getDaysInactive(lastActivityAt: string): number {
  const diffMs = Date.now() - new Date(lastActivityAt).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return 0;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function formatDateTimeBr(isoDate: string): string {
  return new Date(isoDate).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Remove acentos/diacríticos e converte para minúsculas para busca tolerante.
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
