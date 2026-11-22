import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { crmDb, supabase } from '../services/supabaseClient';
import { phoneToVirtualEmail } from '../utils/phone';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  displayName: string;
  loading: boolean;
  signInWithPhone: (phone: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [displayName, setDisplayName] = useState<string>('Equipe HP');
  const [loading, setLoading] = useState<boolean>(true);

  async function resolveProfileName(user: User | null) {
    if (!user) {
      setDisplayName('Equipe HP');
      return;
    }

    const metaName = user.user_metadata?.full_name as string | undefined;
    if (metaName) setDisplayName(metaName);

    const { data } = await crmDb()
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();

    if (data?.full_name) {
      setDisplayName(data.full_name);
    }
  }

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      resolveProfileName(data.session?.user ?? null).finally(() => {
        if (active) setLoading(false);
      });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      resolveProfileName(nextSession?.user ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signInWithPhone(phone: string, password: string) {
    const email = phoneToVirtualEmail(phone);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.toLowerCase().includes('invalid login')) {
        throw new Error('Telefone ou senha inválidos. Verifique seus dados e tente novamente.');
      }
      throw new Error(error.message);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        displayName,
        loading,
        signInWithPhone,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
