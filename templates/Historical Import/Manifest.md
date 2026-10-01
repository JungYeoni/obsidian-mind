---
date: "{{date}}"
description:
type: historical-import
project: "{{machine-identity}}"
display_name: "{{display-name}}"
status: collecting
imported: "{{date}}"
target:
tags:
  - historical-import
  - staging
aliases:
  - "{{display-name}} Import Manifest"
---

# {{display-name}} Import Manifest

## Project Boundary

- Included repositories:
- Excluded repositories:
- Completion year: `unknown`
- Completion-year evidence:

> 완료 연도가 확인되기 전에는 `target`을 비워 두고 archive에 발행하지 않는다.

## Repository References

repository 전체를 `imports/`에 복사하지 않는다. 각 repository마다 아래 항목을 기록한다.

### Repository

- Path:
- Remote:
- Branch or tag:
- Commit SHA:
- Inspected at:

## Preserved Raw Sources

외부에서 사라질 가능성이 있어 `raw/`에 보존한 자료만 기록한다.

| Source | Type | Original location | Preserved path | Captured at |
|---|---|---|---|---|
|  |  |  |  |  |

## Excluded Sources

| Source | Reason |
|---|---|
|  |  |

## Gaps and Conflicts

-

## Publication Checklist

- [ ] 프로젝트 경계 확인
- [ ] repository 기준 commit 고정
- [ ] 완료 연도와 근거 확인
- [ ] 주요 주장에 source와 confidence 기록
- [ ] Decision·Problem Solving 후보 검토
- [ ] Learning Debt 후보 사용자 검토
- [ ] Historical Project Hub 사용자 승인
- [ ] historical validator 통과

## Related

- [[Historical Project Import]]
- [[Historical Import Queue]]
