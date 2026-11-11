// Supabase Edge Function(Deno). 로직은 handler.ts에 있고 여기서는 배선만 한다.
// 이 파일은 Deno 전역/npm: import를 쓰므로 tsconfig와 jest에서 제외된다.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handlePlaceSearch } from './handler.ts';

Deno.serve((req: Request) =>
  handlePlaceSearch(req, {
    fetch,
    kakaoKey: Deno.env.get('KAKAO_REST_KEY') ?? '',
    getUser: async (authHeader: string) => {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
      const { data, error } = await supabase.auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id };
    },
  })
);
