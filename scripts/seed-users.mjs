/**
 * Script de Seed dos Usuários Iniciais — HP Academy CRM
 *
 * Uso:
 *   SUPABASE_URL=https://supabase.evaflow.com.br \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   INITIAL_USERS_PASSWORD=SuaSenhaForte123 \
 *   npm run seed:users
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://supabase.evaflow.com.br').replace(/\/$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_PASSWORD = process.env.INITIAL_USERS_PASSWORD;

if (!SERVICE_ROLE_KEY || !DEFAULT_PASSWORD) {
  console.error(
    'Erro: defina SUPABASE_SERVICE_ROLE_KEY e INITIAL_USERS_PASSWORD no ambiente antes de executar.'
  );
  process.exit(1);
}

const INITIAL_USERS = [
  { name: 'Kelma', phone: '5581995008282', role: 'atendente' },
  { name: 'Mário', phone: '5581988090458', role: 'admin' },
  { name: 'Wendel', phone: '5581991627962', role: 'admin' },
];

async function upsertUser({ name, phone, role }) {
  const email = `${phone}@hpacademy.crm`;

  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      email,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: name,
        phone,
        role,
      },
    }),
  });

  const payload = await createRes.json();

  if (!createRes.ok) {
    if (String(payload?.msg || payload?.message || '').toLowerCase().includes('already')) {
      console.log(`[OK] Usuário já existe: ${name} (${email})`);
      return;
    }
    throw new Error(`Falha ao criar ${name}: ${createRes.status} ${JSON.stringify(payload)}`);
  }

  const userId = payload.id;
  console.log(`[CRIADO] ${name} -> ${email} (id: ${userId})`);

  // Grava perfil na tabela crm.profiles
  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Profile': 'crm',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id: userId,
      full_name: name,
      phone,
      role,
    }),
  });

  if (!profileRes.ok) {
    const errText = await profileRes.text();
    console.warn(`[AVISO] Não foi possível gravar crm.profiles para ${name}: ${errText}`);
  } else {
    console.log(`[PERFIL] crm.profiles sincronizado para ${name}`);
  }
}

async function main() {
  console.log(`Iniciando seed de usuários em ${SUPABASE_URL}...`);
  for (const user of INITIAL_USERS) {
    await upsertUser(user);
  }
  console.log('Seed concluído.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
