import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/**
 * 세션 저장 키. 지오펜스 백그라운드 작업이 네트워크 없이 로그인 여부를 판단하려고 이 키를 직접 읽으므로
 * 클라이언트 내부 필드 대신 명시적인 상수로 고정한다.
 */
export const AUTH_STORAGE_KEY = 'cart-note-auth';

export const supabase = createClient<Database>(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  {
    auth: {
      storage: AsyncStorage,
      storageKey: AUTH_STORAGE_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // 매직링크가 링크를 요청한 기기에서만 세션이 되도록 PKCE를 쓴다(코드 검증자가 이 기기 저장소에만 있음).
      flowType: 'pkce',
    },
  },
);
