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
import { clearUserCache } from '@/src/lib/query-client';
import { closeSession, sessionRestored } from '@/src/lib/session-gate';
import { supabase } from '@/src/lib/supabase';
import { capturePendingInvite } from '@/src/onboarding/pending-invite';
import { exchangeCodeFromUrl } from './auth-api';
import { clearSignedOutDeviceState } from './signed-out-state';
import { readStoredSession } from './stored-session';

export const LINK_ERROR_MESSAGE =
  '로그인 링크가 만료되었거나 올바르지 않아요. 코드로 로그인해 주세요';

type AuthState = {
  session: Session | null;
  loading: boolean;
  /**
   * session은 없지만 저장된 세션(refresh token)이 있는 사용자 id. 오프라인 콜드 스타트에서 만료된 access token을
   * 갱신하지 못하면 auth-js가 null 세션을 보내도 로그아웃이 아니다 — 캐시로 홈을 보여 주고 로그인으로 보내지 않는다.
   */
  offlineUserId: string | null;
  linkError: string | null;
  clearLinkError: () => void;
};

const AuthContext = createContext<AuthState>({
  session: null,
  loading: true,
  offlineUserId: null,
  linkError: null,
  clearLinkError: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineUserId, setOfflineUserId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const clearLinkError = useCallback(() => setLinkError(null), []);

  useEffect(() => {
    // 늦게 끝난 저장소 읽기가 더 최근 이벤트를 덮어쓰지 않게 한다.
    let seq = 0;
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      const mine = ++seq;
      // 같은 기기의 다른 사용자가 이전 캐시(오프라인 큐 포함)를 보지 못하게 로그아웃 시 즉시 비운다.
      if (event === 'SIGNED_OUT') {
        // 큐가 이전 사용자의 요청을 보내지 않게 게이트부터 닫는다.
        closeSession();
        void clearUserCache().catch(() => {});
        // 현재 그룹, 지오펜스(이전 사용자의 지점/메타로 계속 돌지 않게), 온보딩 표시를 지운다.
        void clearSignedOutDeviceState();
      }
      // 이미 소유자 확인을 마친 같은 사용자의 세션이 돌아왔으면(토큰 갱신 성공 등) 게이트를 다시 연다.
      if (next) sessionRestored(next.user.id);
      if (next || event === 'SIGNED_OUT') {
        setSession(next);
        setOfflineUserId(null);
        setLoading(false);
        return;
      }
      // 세션 없음(SIGNED_OUT 아님): 저장된 refresh token이 있으면 오프라인 갱신 실패로 본다.
      void readStoredSession().then((stored) => {
        if (mine !== seq) return;
        setSession(null);
        setOfflineUserId(stored?.userId ?? null);
        setLoading(false);
      });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // 매직링크 딥링크(cartnote://auth?code=…)를 PKCE 코드 교환으로 세션 설정.
  // 이미 로그인돼 있으면 무시한다(남이 보낸 링크로 계정이 바뀌지 않게).
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url) return;
      if (/^cartnote:\/\/join(?![\w.-])/.test(url)) {
        capturePendingInvite(url).catch(() => {});
        return;
      }
      if (!/^cartnote:\/\/auth(?![\w.-])/.test(url)) return;
      supabase.auth
        .getSession()
        .then(({ data }) => {
          if (data.session) return;
          return exchangeCodeFromUrl(url).then(
            () => setLinkError(null),
            () => setLinkError(LINK_ERROR_MESSAGE)
          );
        })
        .catch(() => setLinkError(LINK_ERROR_MESSAGE));
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
    () => ({ session, loading, offlineUserId, linkError, clearLinkError }),
    [session, loading, offlineUserId, linkError, clearLinkError]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
