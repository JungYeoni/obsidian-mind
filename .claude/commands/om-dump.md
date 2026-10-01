---
description: "Freeform capture mode. Dump anything — conversations, decisions, incidents, wins, thoughts — and I'll route it all to the right notes with proper templates, frontmatter, and wikilinks. Archives the raw dump verbatim before routing."
---

Process the following freeform dump. For each distinct piece of information:

1. **Archive the raw dump verbatim first**, before any classification or editing — save the entire `$ARGUMENTS` content as-is to `work/_dumps/YYYY-MM-DD HHmm.md` (create the folder if it doesn't exist; use the current date/time, no other frontmatter needed beyond a one-line header noting when it was captured). AI extraction is lossy — this is the ground truth a later session can check the routed notes against.
2. **Classify** it: decision, incident, 1-on-1 content, win/achievement, architecture, project update, person context, or general work note.
3. **Search first**: Use `qmd vsearch` (or `obsidian search` if QMD unavailable) to check if a related note already exists. Prefer appending to existing notes over creating new ones for small updates.
4. **Create or update** the appropriate note following CLAUDE.md conventions:
   - Correct folder placement (work/active/, work/incidents/, work/1-1/, org/people/, etc.)
   - Full YAML frontmatter with date, description, tags, type-specific fields, and a `source:` field pointing at the archived dump path from step 1 (if a note already has a `source:` from an earlier dump, append to it as a list rather than overwriting)
   - All relevant [[wikilinks]] to people, projects, teams, competencies
5. **Update indexes** as needed (work/Index.md, perf/Brag Doc.md, org/People & Context.md)
6. **Cross-link**: Ensure every new note links to at least one existing note and is linked FROM at least one existing note.

After processing everything, provide a summary:
- Archived to: `work/_dumps/<filename>`
- What was captured and where each piece was filed
- Any new notes created (with paths)
- Any existing notes updated
- Any items you weren't sure how to classify (ask the user)

Content to process:
$ARGUMENTS
