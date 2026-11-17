# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound captures and refreshes learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## 공유 장보기 데이터

### 그룹 (Group)
장보기 데이터를 함께 쓰는 사람들의 단위로, 목록·항목·지점은 모두 정확히 한 그룹에 속하고 그룹 밖으로 옮겨지지 않는다.
*Avoid: 가족(family) — 코드와 DB에는 family로 남아 있지만 같은 개념이다.*

한 사용자는 여러 그룹에 속할 수 있다. 마지막 멤버가 나가면 그룹과 그 안의 데이터가 함께 사라진다.

### 목록 (List)
그룹 안에서 항목을 장소별로 묶는 단위로, 종류가 사야할것(inbox)·마트(store)·온라인(online) 중 하나다.
사야할것 목록은 그룹마다 하나씩 자동으로 생기고 삭제할 수 없다. 지점은 마트 목록에만 붙는다.

### 항목 (Item)
목록 하나에 속한, 사야 할 물건 한 줄로, 체크(완료) 여부를 가진다. 같은 그룹 안의 다른 목록으로만 옮길 수 있다.

### 지점 (Store location)
마트 목록에 등록한 실제 매장 위치로, 근처에 도착하면 그 목록의 남은 항목 수를 알려 주는 기준이 된다. 한 목록에 여러 지점을 둘 수 있다.

## 오프라인 동기화

### 쓰기 큐 (Offline write queue)
항목·목록·지점에 대한 사용자의 쓰기를 입력 순서대로 하나씩 서버에 보내는 단일 대기열로, 오프라인에서 쌓인 쓰기도 앱을 다시 켠 뒤 같은 순서로 재생된다.

큐에 쓰기가 남아 있는 동안 화면은 낙관적 값(아직 서버에 반영되지 않은 결과)을 보여 준다. 그동안에는 낙관적으로 고치는 데이터(항목·목록·지점)를 서버 값으로 다시 맞추지 않는다. 서버 값 맞추기는 큐가 완전히 빈 순간에 한 번 넓게 하고, 그사이 들어온 다른 기기의 실시간 변경은 버린 뒤 그 재조회로 회수한다. 실패한 쓰기가 건드린 데이터만은 큐 상태와 상관없이 곧바로 서버 값으로 되돌린다.
