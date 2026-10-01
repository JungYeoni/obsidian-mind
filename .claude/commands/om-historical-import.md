---
description: "완료된 과거 프로젝트를 repository와 보존 원자료에서 증거 기반으로 복원해 archive에 발행한다."
---

# Historical Project Import

완료 프로젝트만 대상으로 한다. 현재 진행 중인 프로젝트는 `work/active/` workflow를 사용한다.

## Usage

```text
/om-historical-import <repository path or project name>
```

## Workflow

1. [[Historical Import Queue]]에서 한 프로젝트를 `collecting`으로 표시한다.
2. `templates/Historical Import/`를 `imports/historical/<identity>/`에 복사한다.
3. repository는 복사하지 않고 manifest에 path, remote, branch/tag, commit SHA를 기록한다.
4. 외부에서 사라질 가능성이 있는 transcript, 발표자료, 문서, export만 `raw/`에 보존한다.
5. repository facts와 timeline을 먼저 작성한다. 각 주요 주장에 source와 confidence를 붙인다.
6. Decision, Problem Solving, Learning Debt candidate를 각각 작성한다. transcript는 맥락 출처일 뿐 최종 Knowledge가 아니다.
7. Historical Project Hub 초안을 작성한다. `Handoff` 대신 `Reuse Notes`를 사용한다.
8. 사용자에게 identity, 완료 연도 근거, 후보와 불확실성을 검토받는다.
9. 완료 연도가 확인되고 사용자가 승인한 경우에만 `work/archive/<year>/<identity>/`로 발행한다.
10. 중요한 Decision과 Problem Solving만 별도 노트로 승격한다. Learning Debt는 사용자 확인 뒤 별도 workflow로 생성한다.
11. `node --experimental-strip-types .scripts/validate-historical-import.ts <identity>`를 실행한다.
12. `work/Index.md`를 갱신하고 QMD를 재색인한 뒤 vault audit을 실행한다.

## 금지 사항

- 과거 사실을 추측해 채우지 않는다.
- Historical Project Hub 전체에 단일 confidence를 부여하지 않는다.
- `record_work`를 사용하지 않는다.
- source repository에 `.om-project`를 만들지 않는다.
- 완료 연도가 불명확한 프로젝트를 archive에 발행하지 않는다.
- candidate를 자동으로 Decision, Problem Solving, Learning Debt로 승격하지 않는다.

