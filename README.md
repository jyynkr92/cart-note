# Cart Note

가족이나 룸메이트가 하나의 장보기 목록을 함께 쓰는 앱이다. 그룹별로 목록을 만들고 마트 지점을 등록해 두면, 그 마트 근처에 도착했을 때 사야 할 항목 수와 함께 알림을 보낸다. 오프라인에서도 체크, 이동, 삭제가 되고 재연결 시 동기화된다.

## 스택

- Expo 58 (React Native), Expo Router, NativeWind
- TanStack Query (낙관적 업데이트, 오프라인 큐)
- Supabase (Postgres/RLS, Auth 이메일 OTP, Realtime, Edge Function)
- 카카오 로컬 API (지점 검색, Edge Function `kakao-place-search` 경유)
- expo-location / expo-task-manager / expo-notifications (지오펜싱과 근처 알림)
- 테스트: Jest + React Native Testing Library, pgTAP

## 준비물

- Node.js와 npm
- Docker (로컬 Supabase 실행용)
- Supabase CLI는 설치하지 않고 `npx supabase ...`로 실행한다.

## 로컬 Supabase

```bash
npx supabase start
```

이 프로젝트는 기본값이 아닌 포트를 쓴다 (`supabase/config.toml`).

| 서비스 | 포트 |
|---|---|
| API | 55321 |
| DB | 55322 |
| Studio | 55323 |
| 이메일 테스트 UI (Mailpit, 로그인 이메일/OTP 확인) | 55324 |

로그인 코드는 실제로 발송되지 않고 이메일 테스트 UI(Mailpit, `http://127.0.0.1:55324`)에서 확인한다.

### 배포 전 확인

`0008_constraints.sql`은 좌표/반경 범위와 텍스트 길이 CHECK를 추가하면서 기존 행도 검사한다. 이미 데이터가 있는 DB에
적용하기 전에 아래 쿼리로 위반 행이 없는지 확인한다. 결과가 있으면 그 행을 먼저 고치거나 지운 뒤 마이그레이션을 적용한다
(0008은 로컬에 이미 적용됐으므로 고치지 않는다).

```sql
select 'list_locations' as tbl, id::text from public.list_locations
  where not (lat between -90 and 90) or not (lng between -180 and 180)
     or not (radius_m between 50 and 5000)
     or char_length(place_name) > 200 or char_length(address) > 300
union all select 'profiles', user_id::text from public.profiles where char_length(display_name) > 50
union all select 'families', id::text from public.families where char_length(name) > 50
union all select 'lists', id::text from public.lists where char_length(name) > 50
union all select 'items', id::text from public.items where char_length(name) > 200 or char_length(note) > 1000;
```

## 앱 환경 변수

저장소 루트의 `.env`(gitignore 대상)에 둔다. 이름은 `.env.example`과 `src/lib/supabase.ts` 기준이다.

```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<npx supabase status 로 확인한 anon key>
```

## Edge Function 시크릿

`supabase/functions/.env`(gitignore 대상)에 카카오 REST API 키를 넣는다. 형식은 `supabase/functions/.env.example`을 따른다.

```
KAKAO_REST_KEY=<카카오 REST API 키>
```

- 로컬 실행: `npx supabase functions serve` (위 파일을 읽는다)
- 배포: `npx supabase secrets set KAKAO_REST_KEY=<키>`

`kakao-place-search` 응답 상태 코드:

| 상태 | 본문 | 의미 |
| --- | --- | --- |
| 200 | `{ places }` | 검색 결과 |
| 400 / 401 / 405 | `{ error }` | 잘못된 요청 / 인증 실패 / POST 외 메서드 |
| 429 | `{ error: 'rate_limited' }` | 사용자별 할당량(시간당 60회) 초과 |
| 500 | `{ error: 'search unavailable' }` | `KAKAO_REST_KEY` 미설정 |
| 503 | `{ error: 'search unavailable' }` | 할당량 RPC(`consume_search_quota`) 실패. 확인하지 못하면 카카오를 부르지 않는다(fail closed). 일시적 장애라 다시 시도하면 된다 |
| 502 | `{ error: 'search failed' }` | 카카오 호출 실패 |

## 개발 빌드

지오펜싱, 백그라운드 위치, 알림은 Expo Go에서 동작하지 않는다. `expo-dev-client`가 설치되어 있으므로 개발 빌드를 쓴다.

로컬 빌드:

```bash
npx expo prebuild
npx expo run:ios      # 또는
npx expo run:android
```

EAS 빌드를 쓰려면 `eas.json`에 `developmentClient: true`인 development 프로필이 필요하다. 현재 저장소에는 `eas.json`이 없으므로 먼저 만들어야 하며, 이 README는 그 값을 정하지 않는다.

개발 빌드는 아직 수행하지 않았다.

## 명령

| 용도 | 명령 |
|---|---|
| 테스트 | `npm test` |
| 타입 검사 | `npm run typecheck` |
| DB 테스트 (pgTAP, 로컬 Supabase 실행 중이어야 함) | `npx supabase test db` |

`npm run typecheck`는 먼저 `expo customize tsconfig.json`을 실행한 뒤 `tsc --noEmit`을 돌린다. typed routes 타입은 `.expo/types`에서 오며, 이 단계(또는 개발 서버 `npx expo start`)가 생성한다. 이 단계를 빼면 `Href`가 느슨한 타입으로 돌아가 잘못된 경로도 타입 검사를 통과하므로 지우지 않는다. 이 디렉터리는 커밋하지 않는다.

## 문서

- 설계 스펙: [docs/superpowers/specs/2026-11-10-cart-note-design.md](docs/superpowers/specs/2026-11-10-cart-note-design.md)
- 수동 QA 체크리스트: [docs/qa/manual-checklist.md](docs/qa/manual-checklist.md)
