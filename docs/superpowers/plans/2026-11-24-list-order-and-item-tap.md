# 목록 유형 표시·순서 바꾸기·항목 누르기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 목록 카드에 마트·온라인 표시를 붙이고 길게 눌러 끌어 순서를 바꾸게 하며, 상세 화면 헤더 아이콘을 키우고 항목 줄 누르기를 완료 토글로 바꾼다.

**Architecture:** 순서는 그룹 공통 `lists.sort_order`에 저장한다. 놓을 때마다 전체 순서를 새 SECURITY DEFINER RPC `reorder_lists`로 보낸다. 앱은 기존 목록 mutation 패턴(큐 scope, 세션 게이트, withPrepare, 낙관적 갱신)을 그대로 쓴다. 홈 UI는 `react-native-reorderable-list`로 만든다.

**Tech Stack:** Expo 58, React Native 0.88, NativeWind, lucide-react-native, reanimated 4.7, gesture-handler 3.3, TanStack Query v5, Supabase(Postgres/RLS, pgTAP), Jest + RNTL 14(비동기 API는 await).

**Spec:** `docs/superpowers/specs/2026-11-24-list-order-and-item-tap-design.md`

## Global Constraints

- 유형 값(`store`/`online`/`inbox`)은 바꾸지 않는다. 화면 글자만 `사이트` → `온라인`으로 바꾼다.
- inbox("사야할것")는 끌 수 없고 맨 위에 고정한다. 정렬 규칙 `sortLists`(inbox 먼저, 그다음 `sort_order`, 같으면 `created_at`)는 유지한다.
- 순서는 그룹 공통이다(사용자별 순서 없음).
- RPC는 `search_path=''`, SECURITY DEFINER로 만들고, 실행 권한은 `0003_rpc.sql` 방식대로 public·anon에서 회수하고 authenticated에만 준다.
- mutation은 `QUEUE_SCOPE`, `sessionGuarded`, `withPrepare`, `invalidateWhenIdle`을 쓰는 기존 패턴을 따른다(`src/lists/use-lists.ts`의 `define`).
- 반드시 지킬 교훈:
  - `docs/solutions/logic-errors/offline-queue-replay-must-carry-targets-and-reassert-intent.md`
  - `docs/solutions/logic-errors/offline-queue-optimistic-state-clobbered-by-mid-queue-refetch.md`
  - `docs/solutions/ui-bugs/bottom-sheet-content-during-close-animation.md`
- lint 상한은 `--max-warnings=22`이다. 경고를 늘리지 않는다.
- 커밋 메시지는 한국어로 쓰고 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`을 붙인다.

## Review Focus

1. 오프라인에서 순서를 바꾸고 그사이 다른 사람이 목록을 지우거나 만들었을 때, 재연결 뒤 큐가 멈추지 않고 남은 목록 순서가 유지되어야 한다 → Task 1 pgTAP "skips unknown and foreign ids / appends missing lists".
2. 순서를 바꾼 직후 실시간·재조회가 낙관적 순서를 되돌리면 안 된다 → Task 2 "optimistic order survives a refetch while the queue is busy".
3. 새로 만든 목록은 맨 아래에 붙고, 동기화 뒤 재조회해도 같은 자리여야 한다 → Task 2 "create sends max+1 sort_order".
4. 카드를 짧게 누르면 상세로 가고 길게 누르면 끌기만 해야 한다 → Task 3 home 테스트와 시뮬레이터 확인.
5. 항목 줄 누르기가 선택 모드·스와이프 삭제·편집과 충돌하지 않아야 한다 → Task 4 테스트.

---

### Task 1: `reorder_lists` RPC

**Files:**
- Create: `supabase/migrations/0011_reorder_lists.sql`
- Create: `supabase/tests/reorder_lists.test.sql`
- Modify: `src/lib/database.types.ts` (재생성 또는 RPC 시그니처 추가)

**Interfaces:**
- Produces: SQL `public.reorder_lists(p_family_id uuid, p_ids uuid[]) returns void`.
  - 호출자가 `p_family_id`의 멤버가 아니면 예외(`not_member`, 기존 RPC 오류 코드 방식을 따른다).
  - `p_ids` 순서대로, 그 그룹의 inbox가 아닌 목록에 `sort_order = 1..k`를 쓴다.
  - 그룹에 없는 id, 지워진 id, inbox id는 건너뛴다(번호를 소비하지 않는다).
  - `p_ids`에 없는 그 그룹의 inbox가 아닌 목록은 기존 `(sort_order, created_at)` 순서를 지켜 `k+1..`로 뒤에 붙인다.
  - inbox의 `sort_order`는 바꾸지 않는다.

- [ ] **Step 1: pgTAP 테스트 작성** — 다음을 단언한다.
  - 멤버가 아니면 예외가 난다.
  - 순서대로 1..n이 매겨진다.
  - 다른 그룹 id와 없는 id는 무시되고, 그 그룹 목록에 영향이 없다.
  - `p_ids`에서 빠진 목록은 뒤에 붙는다.
  - inbox `sort_order`가 바뀌지 않는다.
  - anon은 실행할 수 없다.
- [ ] **Step 2: 실패 확인** — Run: `npx supabase test db` → 새 파일 FAIL(함수 없음)
- [ ] **Step 3: 마이그레이션 작성** — 로컬에 적용(`npx supabase migration up` 또는 `db reset`)하고, 타입을 다시 만든다.
- [ ] **Step 4: 통과 확인** — `npx supabase test db` 전부 PASS, `npm run typecheck` 통과
- [ ] **Step 5: 커밋** — `feat(db): 목록 순서를 한 번에 저장하는 reorder_lists RPC`

### Task 2: 순서 저장 mutation과 새 목록 순서

**Files:**
- Modify: `src/lists/list-api.ts` — `reorderLists(familyId: string, ids: string[]): Promise<void>` (RPC 호출), `insertList`가 `sortOrder`를 받아 `sort_order`로 보낸다
- Modify: `src/lib/query-keys.ts` — `mk.reorderLists: ['m', 'lists', 'reorder']`
- Modify: `src/lists/use-lists.ts` — `registerListMutations`에 reorder 정의 추가, `useReorderLists()`, `CreateListVars.sortOrder`
- Test: `__tests__/lists/use-lists.test.tsx`, `__tests__/lists/list-api.test.ts`

**Interfaces:**
- Consumes: Task 1 RPC.
- Produces:
  - `type ReorderVars = { familyId: string; ids: string[] }`
  - `useReorderLists(): { mutate(input: { familyId: string; ids: string[] }): void }` (withPrepare: ids가 비면 null)
  - 낙관적 apply: `ids`에 있는 목록의 `sort_order`를 순서대로 1..k로 바꾸고, 나머지 inbox가 아닌 목록은 RPC와 같은 규칙으로 뒤에 붙인다.
  - `export function nextSortOrder(lists: List[]): number` — inbox를 뺀 최대 `sort_order` + 1. 없으면 1.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `nextSortOrder`: 빈 목록은 1, `[0,0]`은 1, `[1,3]`은 4. inbox는 무시한다.
  - create: 변수에 `sortOrder = nextSortOrder(캐시)`가 담기고, `insertList`가 `sort_order`를 보낸다. 낙관적 행도 같은 값이다.
  - reorder: `rpc('reorder_lists', { p_family_id, p_ids })`가 호출된다. 낙관적 캐시에서 `sortLists` 결과가 놓은 순서와 같다. 실패하면 롤백하고 토스트를 띄운다.
  - "optimistic order survives a refetch while the queue is busy": 큐가 멈춘 동안(오프라인) 재조회나 invalidate가 와도 화면 순서가 유지된다(기존 `optimistic-queue-contract` 테스트 방식을 따른다).
- [ ] **Step 2: 실패 확인** — `npx jest __tests__/lists`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npx jest __tests__/lists`, `npm test`, `npm run typecheck`, `npm run lint`
- [ ] **Step 5: 커밋** — `feat: 목록 순서 저장 mutation과 새 목록을 맨 아래에 붙이기`

### Task 3: 홈 — 유형 표시와 길게 눌러 끌기

**Files:**
- Modify: `package.json`, `package-lock.json` — `npx expo install react-native-reorderable-list`
- Modify: `src/lists/ListCard.tsx` — 유형 아이콘(lucide `Store`/`Globe`, `size-4`, `text-muted-foreground`, 접근성 이름 `마트`/`온라인`), `onLongPress` 받기
- Modify: `app/(app)/index.tsx` — `ScrollView` → `ReorderableList`(데이터: inbox 제외 정렬된 목록, header: inbox 카드, footer: `+ 목록 추가`와 초대 안내), `onReorder({from,to})` → 새 ids 계산 → `useReorderLists().mutate`. 목록 추가 시트의 유형 버튼 `사이트` → `온라인`
- Modify: `jest.setup.ts` 또는 `test-utils/` — `react-native-reorderable-list` 목(데이터를 그대로 렌더링하고 `onReorder`와 drag 훅을 테스트에서 부를 수 있게)
- Test: `__tests__/home.test.tsx`, `__tests__/lists/list-card.test.tsx`(새로)

**Interfaces:**
- Consumes: Task 2 `useReorderLists`, `sortLists`.
- Produces: `export function moveId(ids: string[], from: number, to: number): string[]` (순수 함수, `src/lists/` 안에 둔다)

- [ ] **Step 1: 실패하는 테스트 작성**
  - `moveId`: `[a,b,c]`에서 (0→2)는 `[b,c,a]`, (2→0)은 `[c,a,b]`, 같은 자리는 그대로.
  - ListCard: store는 `마트` 아이콘, online은 `온라인` 아이콘, inbox는 아이콘이 없다. 📍는 그대로 보인다.
  - 홈:
    - inbox 카드는 끌 목록(데이터)에 없다.
    - `onReorder({from:0,to:1})`를 부르면 reorder가 `[두번째, 첫번째, ...]` ids로 호출된다.
    - 카드를 짧게 누르면 상세로 이동한다.
    - 목록 추가 시트에 `온라인` 버튼이 있고 `사이트`는 없다.
- [ ] **Step 2: 실패 확인** — `npx jest __tests__/home.test.tsx __tests__/lists`
- [ ] **Step 3: 구현** — 길게 누르기 지연과 집었을 때 모양은 구현자 판단으로 정한다(라이브러리 기본값 우선).
- [ ] **Step 4: 통과 확인** — 관련 테스트, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`
- [ ] **Step 5: 커밋** — `feat: 홈 목록 카드에 유형 표시와 길게 눌러 순서 바꾸기`

> 컨트롤러 게이트: 이 작업 뒤 Expo Go(Metro `--clear` 재시작)에서 길게 눌러 끌기, 짧게 누르기, 스크롤을 확인한다. 가능하면 두 번째 시뮬레이터에서 실시간 반영도 확인한다.

### Task 4: 상세 화면 — 헤더 아이콘과 항목 누르기

**Files:**
- Modify: `app/(app)/list/[id]/index.tsx` — `‹` → `<Icon as={ChevronLeft} className="size-6" />`, `⋯` → `<Icon as={Ellipsis} className="size-6" />`, 버튼 최소 44×44pt(접근성 이름 `뒤로`, `목록 메뉴` 유지). `ItemRow`에 `onEdit` 전달
- Modify: `src/items/ItemRow.tsx` — 줄(이름·메모 영역) 누르면 `onToggle`(선택 모드면 `onSelectToggle`), 오른쪽 연필 버튼(lucide `Pencil`, 접근성 이름 `편집`, 선택 모드에서는 숨김)이 `onEdit`. `onPress` prop은 `onEdit`으로 이름을 바꾼다
- Test: `__tests__/list-detail.test.tsx`, `__tests__/items/*`(ItemRow를 쓰는 테스트)

**Interfaces:**
- Consumes: 없음(독립)

- [ ] **Step 1: 테스트 수정/작성** — 기존 "항목을 누르면 편집이 열린다"는 의도된 변경이므로 바꾼다.
  - 이름을 누르면 완료/해제된다.
  - `편집` 버튼을 누르면 편집 시트가 열린다.
  - 선택 모드에서 이름을 누르면 선택이 토글되고 `편집`은 보이지 않는다.
  - 체크박스는 그대로 완료/해제한다.
  - 헤더 `뒤로`·`목록 메뉴` 버튼이 role button으로 찾아진다.
- [ ] **Step 2: 실패 확인** — `npx jest __tests__/list-detail.test.tsx __tests__/items`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 관련 테스트, `npm test`, `npm run typecheck`, `npm run lint`
- [ ] **Step 5: 커밋** — `feat: 상세 화면 헤더 아이콘을 키우고 항목 줄 누르기를 완료로 바꾼다`
