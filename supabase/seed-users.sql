-- =============================================================================
-- HP Academy CRM — Seed dos Usuários Iniciais via SQL Editor do Supabase
-- Cria Kelma, Mário e Wendel em auth.users, auth.identities e crm.profiles.
--
-- ANTES DE RODAR: altere o valor de `v_password` abaixo para a senha inicial desejada.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_password TEXT := 'HP@2026!'; -- <--- TROQUE AQUI A SENHA INICIAL
  v_user RECORD;
  v_user_id UUID;
  v_email TEXT;
BEGIN
  FOR v_user IN
    SELECT * FROM (VALUES
      ('Kelma',  '5581995008282', 'atendente'),
      ('Mário',  '5581988090458', 'admin'),
      ('Wendel', '5581991627962', 'admin')
    ) AS t(full_name, phone, role)
  LOOP
    v_email := v_user.phone || '@hpacademy.crm';

    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = v_email;

    IF v_user_id IS NULL THEN
      v_user_id := gen_random_uuid();

      INSERT INTO auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        confirmation_token,
        email_change,
        email_change_token_new,
        recovery_token
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        v_user_id,
        'authenticated',
        'authenticated',
        v_email,
        crypt(v_password, gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object(
          'full_name', v_user.full_name,
          'phone', v_user.phone,
          'role', v_user.role
        ),
        now(),
        now(),
        '',
        '',
        '',
        ''
      );

      INSERT INTO auth.identities (
        id,
        user_id,
        provider_id,
        identity_data,
        provider,
        last_sign_in_at,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        v_user_id,
        v_user_id::text,
        jsonb_build_object(
          'sub', v_user_id::text,
          'email', v_email,
          'email_verified', true,
          'phone_verified', false
        ),
        'email',
        now(),
        now(),
        now()
      );
    END IF;

    INSERT INTO crm.profiles (id, full_name, phone, role)
    VALUES (v_user_id, v_user.full_name, v_user.phone, v_user.role)
    ON CONFLICT (phone) DO UPDATE
      SET full_name = EXCLUDED.full_name,
          role = EXCLUDED.role;
  END LOOP;
END $$;
