Shared section: Claude Code and Grok load it at session start; other agents read it when AGENTS.md points here.

# Local conventions (jeongni-vault)

Vault-specific rules on top of the template's `AGENTS.md`. Moved here from the retired `CLAUDE.md` during the v8.4.0 → v10.0.0 upgrade (2026-10-16). The short form of each rule lives in `AGENTS.md` so every agent sees it; this file keeps the detail.

## Learning lifecycle

- **Learning Debt → Project + Knowledge**: every debt links to its source project and, when resolved, the verified Knowledge note.
- **Knowledge → Debt + Projects**: reusable knowledge links to its source debt and where it was applied.
- Entry point: `learning/Index.md` (index node — update it when creating or resolving learning notes), viewed through `bases/Learning Dashboard.base`.
- Properties: `type: learning-debt` or `type: knowledge`; `projects: [project-a]` links learning to source projects; `technologies: [typescript]` groups by technology; `confidence: verified|inferred|unverified` states the evidence level honestly. Never mark Knowledge `verified` without official docs, code inspection, or an experiment.

## Historical import

- `imports/historical/` is staging only: excluded from ordinary QMD search and the om MCP, read only during the explicit `/om-historical-import` workflow.
- Reconstructed projects land in `work/archive/<year>/<project>/`. **Historical Project → Import Manifest**: every reconstructed project links to its staging manifest; individual claims carry their own source and confidence.

## School

- Coursework, class notes, assignments, and exam preparation live in `school/`, indexed by `School.md`.

## Team-shared project docs

- A team project's shared documents live in the team's own repository, not in this vault. The vault connects to it only through the om MCP (local, uncommitted wiring in the clone). Example: TeeQ → `Team-WDA/teeq-docs`, vault side `work/active/teeq/TeeQ (팀 레포 연결).md`.
