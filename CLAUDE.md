# Cart Note — 에이전트 작업 규칙

## 개발 워크플로우

superpowers 흐름(brainstorming → writing-plans → subagent-driven-development → finishing-a-development-branch)을 따른다. 그 사이에 아래 단계를 끼운다.

1. **시작 전 — 과거 교훈 읽기.** 계획을 쓰거나 구현 서브에이전트를 띄우기 전에 `docs/solutions/`를 검색해서(관련 모듈/태그로 grep) 이번 작업과 관련된 learning을 찾는다. 찾은 문서 경로를 구현 지시(dispatch)와 리뷰 지시에 "반드시 지킬 것"으로 함께 넘긴다. 리뷰어는 해당 learning을 어긴 코드를 Important로 보고한다.
2. **구현 완료 후 — 보안 점검.** 전체 브랜치 최종 리뷰 다음에 gstack `/cso`를 실행하고, 발견된 항목은 해결 방안을 정리해 수정한다.
3. **보안 점검 후 — 코드 리뷰.** gstack `/review`(기준 브랜치 `main`)를 실행하고 지적 사항을 수정한다. (개인 스킬 `review`가 아니라 gstack `/review`를 쓴다.)
4. **마지막 — compound(교훈 축적).** 리뷰까지 끝나면 SDD ledger(`.superpowers/sdd/<plan>/progress.md`)의 fix round, parked finding, `Ruling:` 줄, 그리고 `/cso`·`/review`에서 나온 지적을 훑어서 **반복될 수 있는 실수**를 고른다. 교훈 하나당 `ce-compound`를 `mode:non-interactive`로 한 번씩 실행한다(여러 개를 한 번에 묶지 않는다). ce-compound의 기준(최종 코드·테스트만 봐서는 다시 저지를 만한 것)을 통과하지 못한 항목은 기록하지 않는다. 결과물(`docs/solutions/`, 테스트, 린트 규칙, 코딩 규칙)은 같은 브랜치에 커밋한다.
5. 그 다음 finishing-a-development-branch로 마무리한다. SDD workspace는 compound 단계가 끝난 뒤에 지운다(ledger가 compound의 입력이므로).

## 명령

- 테스트: `npm test`, 타입 검사: `npm run typecheck`, DB 테스트: `npx supabase test db`
