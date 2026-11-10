import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/src/lib/supabase';
import { capturePendingInvite } from '@/src/onboarding/pending-invite';
import { setSessionFromUrl } from './auth-api';

export const LINK_ERROR_MESSAGE =
  '로그인 링크가 만료되었거나 올바르지 않아요. 코드로 로그인해 주세요';

type AuthState = {
  session: Session | null;
  loading: boolean;
  linkError: string | null;
  clearLinkError: () => void;
};

const AuthContext = createContext<AuthState>({
  session: null,
  loading: true,
  linkError: null,
  clearLinkError: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  const clearLinkError = useCallback(() => setLinkError(null), []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // 매직링크 딥링크(cartnote://auth#access_token=…)로 세션 설정
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url) return;
      if (/^cartnote:\/\/join(?![\w.-])/.test(url)) {
        capturePendingInvite(url).catch(() => {});
        return;
      }
      if (!/^cartnote:\/\/auth(?![\w.-])/.test(url)) return;
      setSessionFromUrl(url).then(
        () => setLinkError(null),
        () => setLinkError(LINK_ERROR_MESSAGE),
      );
    };
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    supabase.auth.startAutoRefresh();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    return () => {
      sub.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  const value = useMemo(
    () => ({ session, loading, linkError, clearLinkError }),
    [session, loading, linkError, clearLinkError],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
