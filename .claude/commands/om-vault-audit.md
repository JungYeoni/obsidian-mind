# Vault Audit

Deep structural audit of the vault. Checks indexes, folder placement, frontmatter, links, Bases, and consistency. Fix what can be fixed, flag what needs user input.

**When to use**: After substantial sessions, after reorganization, or periodically to maintain vault health. For lighter end-of-session checks, use `/om-wrap-up` instead.

## Usage

```
/om-vault-audit
```

## Subagents

This command orchestrates two subagents for deep analysis:
- **`vault-librarian`** — orphan detection, broken links, frontmatter validation, stale notes, index consistency
- **`cross-linker`** — finds missing wikilinks, orphan notes, broken backlinks

Launch `vault-librarian` first for the structural audit, then `cross-linker` for link quality.

## Workflow

### 1. Check Folder Structure

Verify the vault matches the expected layout:
- `Home.md` exists at vault root
- `bases/` contains all `.base` files (none scattered elsewhere)
- `work/active/` contains only notes with `status: active`
- `work/archive/2025/` and `work/archive/2026/` contain completed work notes; Decision Records keep their decision lifecycle status (`accepted`, `superseded`, `rejected`, etc.)
- Historical Project Hubs live at `work/archive/<completion-year>/<identity>/<identity>.md`; their `completed` value matches the folder year and they use `Reuse Notes`, never `Handoff`
- `work/incidents/` contains only notes tagged `incident`
- `work/1-1/` contains only 1:1 meeting notes
- `org/people/` contains only notes tagged `person`
- `org/teams/` contains only notes tagged `team`
- `learning/` contains only Learning Debt, Knowledge, and its index
- `templates/` contains only template files (with `{{placeholders}}`)
- `thinking/` is clean (no leftover drafts that should have been promoted)
- Nothing unexpected at vault root (allowed: `Home.md`, `CLAUDE.md`, `vault-manifest.json`, `CHANGELOG.md`, `CONTRIBUTING.md`, `README.md`, `LICENSE`, `.gitignore` — no user notes)

### 2. Check Indexes

Read and verify each index file:
- `Home.md` — do embedded Base views reference existing Bases? Are quick links valid?
- `work/Index.md` — are active projects still active? Are completed items in the right section? Any missing notes?
- `brain/Memories.md` — is the "Recent Context" section current? Any stale claims?
- `org/People & Context.md` — are roles, peer selections, and project assignments current?
- `perf/Brag Doc.md` — do PR counts and project descriptions match reality?
- `brain/Skills.md` — are all slash commands registered? Workflows still valid?

### 3. Check Frontmatter Completeness

For each note type, verify required properties:

**Work notes** (`work/active/`, `work/archive/`, excluding Decision Records):
- Required: `date`, `description`, `status`, `tags: [work-note]`
- Optional: `project`, `team`

**Decision Records** (`work/active/`, `work/archive/`):
- Required: `date`, `description`, decision lifecycle `status`, `tags: [decision]`
- Valid lifecycle examples: `proposed`, `accepted`, `superseded`, `rejected`, `deprecated`
- Archive placement records project lifecycle and does not force `status: completed`

**Incident notes** (`work/incidents/`):
- Required: `date`, `quarter`, `description`, `tags: [work-note, incident]`
- Required for main incident notes: `ticket`, `severity`, `role`, `status`

**Person notes** (`org/people/`):
- Required: `date`, `title`, `description`, `tags: [person]`
- Optional but recommended: `team`

**Team notes** (`org/teams/`):
- Required: `date`, `description`, `tags: [team]`

**Brain notes** (`brain/`):
- Required: `description`, `tags: [brain]`

**Learning Debt** (`learning/`):
- Required: `date`, `description`, `type: learning-debt`, `status`, `projects`, `confidence`, `tags: [learning, learning-debt]`

**Knowledge** (`learning/`):
- Required: `date`, `description`, `type: knowledge`, `status`, `confidence`, `tags: [learning, knowledge]`
- `status: verified` requires evidence from official documentation, code inspection, or an experiment

**Historical Project Hubs** (`work/archive/<year>/<identity>/<identity>.md`):
- Required: `date`, `description`, `type: historical-project`, `status: completed`, `lifecycle: archived`, `project`, `display_name`, `completed`, `imported`, `reconstruction_status`, `source_manifest`
- Must not use a whole-note `confidence`; attach source and confidence to individual claims
- Must contain `## Reuse Notes` and must not contain `## Handoff`
- Do not publish when the completion year is unknown

**1:1 notes** (`work/1-1/`):
- Required: `date`, `quarter`, `description`, `tags: [work-note]`

### 4. Check for Duplicate Tags

Scan all notes for duplicate entries in the `tags` array (e.g., `tags: [person, person]`). This is a known issue — fix any found.

### 5. Check Status/Folder Alignment

- Notes in `work/active/` must have `status: active`
- Non-decision work notes in `work/archive/` must have `status: completed`
- Decision Records keep their decision lifecycle status in either active or archive folders
- No `status: active` notes in archive, no `status: completed` non-decision work notes in active

### 6. Check Bases

For each `.base` file in `bases/`:
- Do filters still match the expected notes?
- Are templates excluded? (filters should include `!file.inFolder("templates")` where relevant)
- Do referenced properties exist in the target notes?
- Do formula references exist?

### 7. Check for Orphans

- Are there notes in `work/active/` or `work/archive/` not linked from `work/Index.md`?
- Are there incident notes not linked from `work/Index.md` Incidents section?
- Are there people notes not linked from `org/People & Context.md`?
- Are there notes without any inbound links at all? (Use `obsidian orphans` if available, or grep for `[[NoteName]]` references)
- Are there thinking notes that should have been promoted or deleted?
- Are Learning Debt and Knowledge notes linked from `learning/Index.md`, their source projects, or each other?

### 8. Check Links

- Scan for wikilinks that reference notes that don't exist (broken links)
- Check that bidirectional links exist where expected (work note ↔ person, work note ↔ competency)
- Verify `## Related` sections aren't empty on work notes

### 9. Check for Stale Context

- Read `brain/Memories.md` "Recent Context" — is anything outdated?
- Read `org/People & Context.md` — any roles, teams, or relationships that changed?
- Check `brain/Key Decisions.md`, `brain/Patterns.md`, `brain/Gotchas.md` for outdated claims
- Check `brain/North Star.md` — does Current Focus reflect reality?

### 10. Check for Mixed Context

Per vault rules, each note should cover ONE concept. Flag notes that:
- Mix project work with review prep
- Mix personal conversations with project evidence
- Have 3+ independent sections that don't need each other

### 11. Check Claude Config

- `.claude/settings.json` — are hooks well-formed and referencing correct paths?
- `.claude/commands/` — do all commands reference correct folder structure?
- `CLAUDE.md` — any stale instructions that contradict current vault state?

### 12. Fix and Report

- Fix what's clearly wrong (broken links, missing frontmatter, duplicate tags, wrong folder)
- For ambiguous issues, list them and ask the user
- Summarize:
  - **Fixed**: issues resolved
  - **Flagged**: needs user input
  - **Suggested**: improvements for the vault

## Important

- Don't delete anything without asking
- Don't create new notes during audit — just fix existing ones
- Preserve existing frontmatter when editing
- If a note is in the wrong folder, move it with `git mv`
- Update `brain/Memories.md` index if memory topics changed
- Use parallel agents for large audits (e.g., one checking work/, one checking org/, one checking perf/)
