import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface Profile {
  nome: string;
  role: "admin" | "user";
  senha_temporaria: boolean;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  moduleAccess: Set<string>;
  loading: boolean;
  /** true enquanto o perfil e as permissões de módulo ainda estão sendo carregados do banco */
  loadingProfile: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [moduleAccess, setModuleAccess] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(true);

  // Efeito 1: apenas auth (síncrono) — nunca fazer queries DB aqui para evitar deadlock
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      // Preserva a referência do user se for o mesmo ID — evita que o Effect 2
      // (busca de perfil) re-execute a cada TOKEN_REFRESHED ao voltar de aba
      setUser(prev => {
        const next = session?.user ?? null;
        if (prev?.id === next?.id) return prev;
        return next;
      });
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Efeito 2: busca profile sempre que o user mudar (seguro para queries DB)
  useEffect(() => {
    if (!user) {
      setProfile(null);
      setIsAdmin(false);
      setModuleAccess(new Set());
      setLoadingProfile(false);
      return;
    }

    setLoadingProfile(true);

    // Busca perfil e acessos de módulo em paralelo
    Promise.all([
      supabase.from("profiles").select("nome, role, senha_temporaria").eq("user_id", user.id).maybeSingle() as any,
      supabase.from("user_module_access").select("module_key, has_access").eq("user_id", user.id),
    ]).then(([{ data: p }, { data: accesses }]) => {
      setProfile(p ?? null);
      setIsAdmin(p?.role === "admin");
      const granted = new Set(
        (accesses ?? []).filter((a) => a.has_access).map((a) => a.module_key),
      );
      setModuleAccess(granted);
      setLoadingProfile(false);
    }).catch(() => {
      setLoadingProfile(false);
    });
  }, [user]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, isAdmin, moduleAccess, loading, loadingProfile, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
