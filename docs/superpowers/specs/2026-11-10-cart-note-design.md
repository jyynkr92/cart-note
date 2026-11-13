# Cart Note — 설계 문서

- 작성일: 2026-11-10
- 상태: 사용자 검토 대기

## 1. 목적과 범위

장볼 항목을 마트/사이트별 목록으로 정리하고, 가족(또는 여러 그룹)과 실시간으로 공유하며, 등록한 마트 근처에 오면 알림을 받는 모바일 앱.

### 성공 기준
- 혼자 쓰는 사람은 로그인 직후 그룹 개념 없이 바로 항목을 적을 수 있다.
- "사야할것"(inbox)에 적어둔 항목을 마트/사이트 목록으로 옮길 수 있다.
- 같은 그룹 멤버가 체크/추가한 내용이 다른 기기에 즉시 반영된다.
- 매장 안 통신이 끊겨도 목록 열람과 체크가 가능하고, 재연결 시 반영된다.
- 위치를 등록한 마트 근처(반경 약 300m)에 가면, 안 산 항목이 있을 때 알림이 온다.

### 이번 버전에서 제외
구매 기록/자주 사는 것 추천, 소셜 로그인, 수량 필드, 그룹 합치기, 그룹 간 항목 이동, 원격 푸시 알림, 웹 빌드 최적화(Expo 웹은 동작 수준만).

## 2. 기술 스택

| 영역 | 선택 |
|---|---|
| 앱 | Expo (React Native, TypeScript), Expo Router, EAS 개발 빌드 |
| UI | React Native Reusables + NativeWind (바텀 시트 등 미제공 컴포넌트만 별도 라이브러리) |
| 서버/DB | Supabase (Postgres, Auth, Realtime, Edge Functions) |
| 데이터 패칭 | TanStack Query (캐시 영속화 + 오프라인 mutation 큐) |
| 위치/알림 | expo-location (지오펜싱), expo-task-manager, expo-notifications (로컬 알림) |
| 장소 검색 | 카카오 로컬 API (키워드 검색) — Supabase Edge Function 경유 |

플랫폼: iOS/Android 네이티브 앱. 지오펜싱은 Expo Go에서 동작하지 않으므로 개발 빌드(EAS dev client) 필요.

## 3. 데이터 모델

```
profiles          user_id (PK, → auth.users), display_name, created_at
families          id, name, invite_code (unique, 6자리 숫자), created_by, created_at
family_members    family_id, user_id, joined_at
                  PK(family_id, user_id)
lists             id, family_id, name, kind ('inbox' | 'store' | 'online'), sort_order, created_at
                  UNIQUE(id, family_id)
                  부분 UNIQUE(family_id) WHERE kind = 'inbox'
list_locations    id, list_id, family_id, place_name, address, lat, lng, kakao_place_id,
                  radius_m (기본 300)
                  FK(list_id, family_id) → lists(id, family_id) ON DELETE CASCADE
items             id, list_id, family_id, name, note (nullable), is_done, done_at,
                  sort_order, created_by, created_at, updated_at
                  FK(list_id, family_id) → lists(id, family_id) ON DELETE CASCADE
```

### 규칙
- 한 사용자는 여러 그룹에 속할 수 있다.
- `inbox` 목록("사야할것")은 그룹 생성 시 자동 생성되며 삭제 불가(DB 트리거로 차단). 이름 변경은 가능.
- `store` 목록만 위치(`list_locations`)를 가질 수 있다. 한 목록에 여러 지점 등록 가능.
- `items.family_id`/`list_locations.family_id`는 RLS·Realtime 필터용 중복 컬럼이며, 복합 FK로 목록의 `family_id`와 일치가 강제된다. 결과적으로 그룹 간 항목 이동은 DB에서 거부된다.
- 수량은 별도 필드 없이 이름에 적는다(예: "뉴케어 당케어 총 4박스").
- `updated_at`은 트리거로 갱신한다.

### 권한 (RLS)
- SQL 함수 `is_member(family_id)`를 두고 `families`, `family_members`, `lists`, `list_locations`, `items`의 모든 select/insert/update/delete 정책에서 사용한다.
- `profiles`: 본인 행은 읽기/쓰기, 같은 그룹 멤버의 행은 읽기.
- `families` insert와 `family_members` insert는 직접 허용하지 않고 아래 RPC로만 수행한다.

### RPC (security definer)
| 함수 | 동작 |
|---|---|
| `create_family(name)` | 그룹 생성 + 호출자를 멤버로 추가 + inbox 목록 생성 (한 트랜잭션). 초대 코드 생성 |
| `join_family(code)` | 코드 검증 후 멤버 추가. 잘못된 코드/이미 멤버인 경우 구분된 에러 반환 |
| `leave_family(id)` | 멤버 제거. 마지막 멤버면 그룹 삭제(하위 데이터 cascade) |
| `regenerate_invite_code(id)` | 멤버만 호출 가능. 새 코드 발급(기존 코드 무효) |

## 4. 인증과 온보딩

### 로그인
- Supabase 이메일 OTP. 메일에 **6자리 코드(기본)** 와 매직링크(보조)를 함께 넣는다.
- 앱의 로그인 화면은 이메일 입력 → 코드 입력 2단계. 매직링크는 PKCE(`cartnote://auth?code=…`)로 받아 링크를 요청한 기기에서만 코드 교환으로 세션 설정. 토큰 프래그먼트 링크는 거부하고, 이미 로그인돼 있으면 링크를 무시한다. (보안 점검(/cso) 반영)
- 가입과 로그인은 같은 절차. 비밀번호 없음.

### 첫 로그인
```
로그인 → profiles 없음 → 이름 입력 → profiles 생성
  ├─ 대기 중인 초대 코드 있음(초대 링크로 진입) → join_family(code) → 홈
  └─ 없음 → create_family('내 장보기') → 홈
           (화면 하단 "초대 코드가 있나요?" → 코드 입력 → 참여)
```
- 초대 링크로 들어온 사람에게는 개인 그룹을 만들지 않는다.

### 초대
- 설정 → "가족 초대하기" → 시스템 공유 시트로 메시지 전송:
  초대 코드 + 스토어 링크 + `cartnote://join?code=XXXXXX`
- 딥링크 진입 시 코드가 미리 채워진 참여 화면을 연다. 로그인 전이면 코드를 로컬에 보관했다가 로그인 직후 처리.
- 그룹 멤버가 1명뿐이면 홈 하단에 작은 초대 안내를 노출한다.

### 다른 그룹 참여 후 빈 그룹 정리
- 참여 직후, 호출자가 유일한 멤버이고 항목이 0개인 다른 그룹이 있으면 "비어 있는 '<그룹명>' 그룹을 삭제할까요? [삭제] [유지]"를 묻는다. 삭제 시 `leave_family` 호출.

## 5. 화면 구성 (Expo Router)

```
(auth)/login                 이메일 입력 → 6자리 코드 입력
(auth)/profile               첫 로그인 시 이름 입력
(auth)/join                  초대 코드 입력 (딥링크로 코드 미리 채움)

(app)/index                  목록 홈
(app)/list/[id]              목록 상세
(app)/list/[id]/locations    마트 지점 관리
(app)/settings               그룹 설정 + 내 설정
```

### 목록 홈
- 상단 그룹 전환 메뉴 "<그룹명> ▾": 그룹 목록 / 이름 변경 / + 새 그룹 / 코드로 참여. 그룹이 하나면 이름만 표시하는 단순 형태.
- 마지막 선택 그룹은 기기 로컬에 저장.
- "사야할것" 카드 상단 고정, 그 아래 마트/사이트 목록 카드. 카드에 남은 항목 수, 위치 등록 마트는 📍 표시.
- "+ 목록 추가": 이름, 유형(마트/사이트).

### 목록 상세
- 상단 입력창: 이름 입력 후 엔터로 즉시 추가. 메모는 항목 탭 → 편집 시트에서.
- 체크박스 탭으로 완료 토글. 완료 항목은 하단 "완료됨 (n)" 영역에 회색으로 표시(`done_at` 순).
- 왼쪽 스와이프 → 삭제.
- 길게 누르기 → 선택 모드 → "다른 목록으로 이동"(같은 그룹 목록 선택 시트) / 선택 삭제.
- ⋯ 메뉴:
  - 완료 항목 지우기 — `is_done = true` 항목 삭제
  - 목록 비우기 — 확인창 후 목록의 모든 항목 삭제
  - 목록 편집(이름 변경) / 목록 삭제(inbox 제외, 확인창)
  - 지점 관리(store 목록만)

### 마트 지점 관리
- 검색창 → Edge Function `kakao-place-search` → 결과 목록 → 탭하여 추가.
- 등록된 지점 목록, 스와이프 삭제.

### 설정
- 그룹: 이름 변경, 초대 코드 보기/복사/재발급, 가족 초대하기, 멤버 목록, 그룹 나가기(확인창).
- 새 그룹 만들기 / 코드로 참여.
- 위치 알림 켜기/끄기(이 기기), 권한 상태와 시스템 설정 이동 버튼.
- 내 이름 변경, 로그아웃.

## 6. 동기화와 오프라인

- 모든 쓰기(추가/체크/수정/이동/삭제/비우기)는 TanStack Query 낙관적 업데이트. 실패 시 롤백 + 토스트.
- 쿼리 캐시는 AsyncStorage에 영속화하여 오프라인에서도 목록 열람 가능.
- 오프라인 중 mutation은 일시정지 큐에 쌓고 재연결 시 순서대로 재실행(`onlineManager` + mutation 영속화 + 기본 mutation 함수 등록).
- 충돌은 마지막 쓰기 우선(last-write-wins).
- Realtime: 현재 선택 그룹의 `family_id`로 `items`, `lists`, `list_locations`의 INSERT/UPDATE를 구독해 캐시에 반영. DELETE 이벤트는 RLS 필터가 적용되지 않고 id만 오므로, 수신 시 해당 쿼리를 무효화해 재조회한다. 재연결 시 전체 무효화.
- 그룹 전환 시 구독을 교체한다.

## 7. 위치 알림

### 장소 검색
- Edge Function `kakao-place-search(query)`: 인증된 사용자만 호출 가능. 서버에 보관한 카카오 REST 키로 키워드 검색 후 `place_name, address, lat, lng, kakao_place_id` 목록 반환.

### 지오펜스 등록 (기기)
- 시점: 앱 시작, 포그라운드 복귀, `list_locations` 변경(Realtime), 알림 설정 변경.
- 내가 속한 **모든 그룹**의 `list_locations` 조회.
- 20개(iOS 한도) 초과 시 현재 위치에서 가까운 20곳 선택.
- 알림 켜짐 → `Location.startGeofencingAsync(TASK, regions)`, 꺼짐 → `stopGeofencingAsync`.
- 알림 설정(켜기/끄기)과 지오펜스 메타(region id → list_id, 그룹명, 지점명)는 기기 로컬 저장.

### 진입 처리 (백그라운드 TaskManager)
1. Enter 이벤트의 region → list_id 확인.
2. 같은 목록에 대해 3시간 내 알림 이력이 있으면 종료.
3. 서버에서 해당 목록의 미완료 항목 수 조회(실패 시 캐시 값 사용, 캐시도 없으면 개수 없이 알림).
4. 0개면 종료. 1개 이상이면 로컬 알림: "[그룹명] 코스트코 양재점 근처예요 · 사야 할 것 6개". 그룹이 하나뿐이면 그룹명 생략.
5. 알림 탭 → 해당 그룹으로 전환 → `list/[id]` 열기.

### 권한
- 알림을 처음 켤 때: 알림 권한 → 위치 "앱 사용 중" → "항상 허용" 순으로 요청.
- 거부 시 설정 화면에 상태와 시스템 설정 이동 버튼 표시, 토글은 꺼진 상태 유지.

## 8. 에러 처리

| 상황 | 처리 |
|---|---|
| 쓰기 실패(온라인) | 롤백 + 토스트 |
| 오프라인 쓰기 | 큐잉, 상단에 "오프라인" 표시 |
| 잘못된 초대 코드 / 이미 멤버 | 입력 화면에 구분된 안내 문구 |
| 로그인 코드 만료/오류 | 재전송 버튼 |
| 카카오 검색 실패 | 검색 결과 영역에 재시도 안내 |
| inbox 삭제 시도 | UI에서 메뉴 미노출 + DB 트리거로 차단 |
| 위치 권한 거부 | 설정 화면 안내 |

## 9. 테스트

- **DB**: Supabase 로컬 환경에서 pgTAP으로 RLS(타 그룹 접근 불가), RPC(`create_family`, `join_family`, `leave_family`, `regenerate_invite_code`), inbox 삭제 차단, 그룹 간 이동 차단(복합 FK) 검증.
- **로직 단위 테스트(Jest)**: 지오펜스 20개 선택, 알림 3시간 쿨다운, 완료 항목 정렬, 알림 문구 생성, 빈 그룹 정리 조건.
- **컴포넌트 테스트(React Native Testing Library)**: 목록 상세의 추가, 체크, 스와이프 삭제, 선택→이동, 완료 항목 지우기, 목록 비우기.
- **수동 체크리스트(개발 빌드 실기기/시뮬레이터 위치 조작)**: 지오펜스 진입 알림, 쿨다운, 알림 탭 이동, 오프라인→재연결 동기화, 초대 딥링크.

## 10. 미해결 사항

없음.
