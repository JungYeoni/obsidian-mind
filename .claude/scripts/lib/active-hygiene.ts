/**
 * Active-folder hygiene scan — shared by the SessionStart and Stop hooks
 * (#98/#103), plus the write-time detectors validate-write.ts consumes.
 *
 * Drift modes surfaced:
 *
 *   1. COMPLETED-NOT-ARCHIVED — a note whose frontmatter `status` is
 *      `completed`/`archived`/`done` but is still sitting in `work/active/`.
 *      It pollutes the SessionStart task aggregation and the Work Dashboard
 *      Base, and it's how the pile forms (every deferred archive starts
 *      here).
 *
 *   2. UNGROUPED MULTI-FILE TOPIC — two or more notes sitting *loose in the
 *      active/ root* (not in a subfolder) that share a distinctive topic
 *      token. Convention: once a workstream has >1 note, it gets a folder
 *      (`active/<Topic>/`). This catches clusters before they scatter.
 *
 *   3. OVERSIZED NOTES — past ~25KB a note has outgrown one node and wants
 *      a SPLIT, never trimming. Bytes, not lines: giant single-line entries
 *      hide in low line counts.
 *
 *   4. OPEN LOOPS (#106) — follow-up surfaces (1:1 action items, meeting
 *      follow-ups, incident watch-fors) with live signals that went quiet.
 *      Watch dirs and section headings are manifest-configurable so a
 *      reshaped vault retargets its own surfaces without code edits.
 *
 *   5. MEETINGS-INBOX PRESSURE — work/meetings/ is a staging inbox drained
 *      by /om-intake; raw exports sitting there are unprocessed by
 *      definition.
 *
 * Philosophy: pattern-based, no LLM, conservative. This NUDGES — it never
 * moves files. False negatives (missing a cluster) are preferable to false
 * positives (nagging about unrelated notes), so the cluster detector leans
 * hard on a document-frequency guard: a token shared by *more than half*
 * the root notes is treated as a generic team/element word, not a groupable
 * topic.
 */

import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { escapeRegex } from "./regex.ts";
import { parsePromotedMarker, type PromotedRef } from "./memory-promoted.ts";
import {
	extractFrontmatterField,
	isInfraFilename,
	isMarkdownFilename,
	MACHINERY_DIRS,
} from "./session-start.ts";

const ACTIVE_REL = "work/active";

// Frontmatter status values that mean "this should not be in active/".
const ARCHIVABLE_STATUS = new Set(["completed", "archived", "done"]);

// Generic process words that must never anchor a topic cluster. The
// document-frequency guard catches most of these already (a word in >50%
// of root notes is excluded), but common nouns can slip under that in a
// small active/ — so we hard-stop the worst offenders. Kept short on
// purpose; over-stopwording would suppress real project nouns.
const STOPWORDS = new Set([
	"onboarding", "branch", "the", "and", "for", "with", "from", "into",
	"that", "this", "report", "plan", "sync", "call", "prep", "notes",
	"doc", "document", "meeting", "review", "draft", "log", "investigation",
	"framework", "roadmap", "playbook", "support", "screen", "verification",
	"remediation", "delivery", "strategy", "execution", "kickoff",
	"discovery", "prompt", "audit", "analysis", "experiment",
]);

// Strip a leading `YYYY-MM-DD ` date prefix and the `.md` extension, then
// tokenise the title into lowercased alphanumeric words.
function titleTokens(filename: string): string[] {
	const title = filename
		.replace(/\.md$/i, "")
		.replace(/^\d{4}-\d{2}-\d{2}\s+/, "");
	return title
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length >= 4 && !/^\d+$/.test(t) && !STOPWORDS.has(t));
}

export type TopicCluster = {
	readonly token: string;
	readonly files: readonly string[]; // root-level filenames
};

export type OversizedNote = {
	readonly path: string; // vault-relative
	readonly sizeKb: number;
};

export type OpenLoop = {
	readonly path: string; // vault-relative
	readonly ageDays: number;
	readonly openItems: number;
};

export type InboxPressure = {
	readonly count: number;
	readonly oldestDays: number;
};

/**
 * The memory inbox additionally reports how many promotions are DECORATIVE.
 *
 * A separate type rather than an optional field on `InboxPressure`: the
 * meetings inbox has no promotion concept, and an optional field shared by two
 * producers is how one of them silently stops populating it.
 */
export type MemoryInboxPressure = InboxPressure & {
	/** Promoted captures whose marker carries no anchor, so nothing is servable. */
	readonly namedOnly: number;
};

export type ActiveHygieneReport = {
	// Vault-relative paths (e.g. "work/active/Foo.md").
	readonly completedInActive: readonly string[];
	readonly ungroupedClusters: readonly TopicCluster[];
	readonly oversizedNotes: readonly OversizedNote[];
	readonly openLoops: readonly OpenLoop[];
	readonly inboxPressure: InboxPressure | null;
	readonly memoryInbox: MemoryInboxPressure | null;
	readonly teamSharedLeaks: readonly TeamSharedLeak[];
};

// ---------------------------------------------------------------------------
// Open-loops detection (#106). Conservative by design (false negatives over
// nagging): checkboxes count only inside their follow-up sections, dirs of
// per-person dated notes scan only the LATEST note per person (older notes'
// items are historical carry-forwards), and output is capped. Hook output
// prints paths + counts ONLY — never the matched line content (follow-up
// lines can be sensitive, and hook output may be pasted anywhere).
// ---------------------------------------------------------------------------

export const OPEN_LOOP_DAYS = 14;
export const OPEN_LOOP_CAP = 5;
const OPEN_LOOP_DEFAULT_DIRS = ["work/1-1", "work/meetings", "work/incidents"];
const OPEN_LOOP_DEFAULT_SECTIONS = ["action items", "what to watch"];
const OPEN_LOOP_PHRASE = /\b(waiting on|watch for)\b/i;

export type OpenLoopConfig = {
	readonly dirs: readonly string[];
	readonly sectionRe: RegExp;
};

/**
 * Read the open-loops watch surfaces from the manifest: `open_loop_dirs`
 * (vault-relative directories) and `open_loop_sections` (heading names,
 * matched case-insensitively). Different vault shapes have different
 * follow-up surfaces — the detector is the invariant, the surfaces are
 * config. Missing/malformed fields fall back to the template defaults.
 */
export function parseOpenLoopConfig(manifestJson: string | null): OpenLoopConfig {
	let dirs: readonly string[] = OPEN_LOOP_DEFAULT_DIRS;
	let sections: readonly string[] = OPEN_LOOP_DEFAULT_SECTIONS;
	if (manifestJson !== null) {
		try {
			const parsed = JSON.parse(manifestJson) as Record<string, unknown>;
			const d = parsed["open_loop_dirs"];
			if (Array.isArray(d)) {
				// Vault-relative plain paths only: no absolute paths, no
				// dot-dot segments, no backslashes — a misconfigured entry
				// must not walk the scan outside the vault root.
				const valid = d.filter(
					(x): x is string =>
						typeof x === "string" &&
						x.length > 0 &&
						!x.startsWith("/") &&
						!/^[A-Za-z]:/.test(x) &&
						!x.includes("\\") &&
						!x.split("/").includes("..") &&
						!x.split("/").includes("."),
				);
				if (valid.length > 0) dirs = valid;
			}
			const s = parsed["open_loop_sections"];
			if (
				Array.isArray(s) &&
				s.length > 0 &&
				s.every((x) => typeof x === "string" && x.length > 0)
			) {
				sections = s as string[];
			}
		} catch {
			/* malformed manifest → defaults */
		}
	}
	const sectionRe = new RegExp(
		`^##+\\s+(${sections.map((s) => escapeRegex(s)).join("|")})`,
		"i",
	);
	return { dirs, sectionRe };
}

/**
 * Count live follow-up signals in a note: unchecked `- [ ]` items inside a
 * configured follow-up section, plus explicit waiting-on / watch-for lines
 * anywhere. Pure — exported for tests.
 */
export function countOpenLoops(content: string, sectionRe: RegExp): number {
	let inActionSection = false;
	let count = 0;
	for (const line of content.split("\n")) {
		if (/^##+\s/.test(line)) {
			inActionSection = sectionRe.test(line);
			continue;
		}
		const unchecked = /^\s*-\s\[\s\]/.test(line);
		if (inActionSection && unchecked) count++;
		else if (OPEN_LOOP_PHRASE.test(line)) count++;
	}
	return count;
}

/** `<Person> YYYY-MM-DD.md` → person key, or null for non-1:1-shaped names. */
function oneOnOnePersonKey(filename: string): string | null {
	const m = filename.match(/^(.+?)\s+\d{4}-\d{2}-\d{2}\.md$/i);
	return m?.[1] ?? null;
}

/**
 * The latest-per-person reduction applies only to 1:1-style dirs (name
 * contains "1-1" or "1on1") — elsewhere a date-suffixed title like
 * "Weekly Sync 2026-07-01.md" would false-match the person shape and
 * silently drop older meeting notes from the scan.
 */
function isOneOnOneDir(relDir: string): boolean {
	return /1-?on?-?1|1-1/i.test(relDir.split("/").pop() ?? relDir);
}

function findOpenLoops(
	root: string,
	nowMs: number,
	config: OpenLoopConfig,
): OpenLoop[] {
	const candidates: string[] = [];
	for (const dir of config.dirs) {
		const files = walkMarkdown(root, dir);
		if (isOneOnOneDir(dir)) {
			const latestByPerson = new Map<string, string>();
			for (const rel of files.sort()) {
				const base = rel.split("/").pop() ?? rel;
				const person = oneOnOnePersonKey(base);
				if (person === null) continue; // non-1:1-shaped → skip (conservative)
				latestByPerson.set(person, rel); // sorted → last wins = latest date
			}
			candidates.push(...latestByPerson.values());
		} else {
			candidates.push(...files);
		}
	}

	const out: OpenLoop[] = [];
	// Overlapping configured dirs (e.g. "work" + "work/meetings") must not
	// scan a file twice — duplicates would crowd the cap.
	for (const rel of [...new Set(candidates)]) {
		// Archive notes hold historical bulk by convention — a "waiting on"
		// line in an archive is a record, not a live loop.
		if ((rel.split("/").pop() ?? "").includes("Archive")) continue;
		// The meetings-inbox scaffold is template prose, not a follow-up
		// surface. It carries no checkboxes today, so this changes nothing
		// yet — it stops the shipped file becoming an unclearable open loop
		// the first time its instructions gain one (#155).
		if (isInboxScaffold(rel)) continue;
		let content: string;
		let mtimeMs: number;
		try {
			const full = join(root, rel);
			content = readFileSync(full, "utf-8");
			mtimeMs = statSync(full).mtimeMs;
		} catch {
			continue;
		}
		const ageDays = Math.floor((nowMs - mtimeMs) / 86_400_000);
		if (ageDays < OPEN_LOOP_DAYS) continue;
		const openItems = countOpenLoops(content, config.sectionRe);
		if (openItems === 0) continue;
		out.push({ path: rel, ageDays, openItems });
	}
	// Oldest first, capped — surface the longest-dead loops, stay quiet-ish.
	return out.sort((a, b) => b.ageDays - a.ageDays).slice(0, OPEN_LOOP_CAP);
}

// ---------------------------------------------------------------------------
// Oversized-note detection. Size is a STRUCTURE signal, never a brevity
// signal: past the threshold a note wants a SPLIT (domain notes / event-log
// satellites / a cluster folder — verbatim, index left behind), never
// trimming. Vault-wide by design — existing large chronological logs flag
// immediately and become the split backlog, not noise.
// ---------------------------------------------------------------------------

export const MONOLITH_BYTES = 25_000;

/** Archive notes are bulk by design — the only exemption. */
export function isMonolithExempt(filename: string): boolean {
	return filename.includes("Archive");
}

// Never walked for oversize: machinery (shared with the SessionStart
// listing, so the two can't drift — see MACHINERY_DIRS) plus `templates/`,
// whose files are scaffold rather than notes.
const OVERSIZE_SKIP_DIRS = new Set([...MACHINERY_DIRS, "templates"]);

// Recursively collect .md files under a directory, returning paths relative
// to `root`. Tolerates a missing directory (returns []). Shared by every
// detector so subfoldered workstreams are never skipped (#104).
export function walkMarkdown(root: string, relDir: string): string[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(join(root, relDir), { withFileTypes: true });
	} catch {
		return [];
	}
	const out: string[] = [];
	for (const e of entries) {
		const rel = `${relDir}/${e.name}`;
		if (e.isDirectory()) out.push(...walkMarkdown(root, rel));
		else if (e.isFile() && isMarkdownFilename(e.name)) out.push(rel);
	}
	return out;
}

/**
 * Only a project's own hub note carries project-level status. A sub-note
 * inside a topic cluster (session log, submission, decision) can be
 * "completed" on its own terms — this session is done, this submission went
 * out — without the project itself being finished, and flagging those
 * trains the reader to ignore the whole section. A hub note is either a
 * loose file directly in active/ root (a single-note project) or the file
 * named after its containing topic folder (work/active/<Topic>/<Topic>.md),
 * per the cluster convention in CLAUDE.md. Anything deeper, or any other
 * name inside a topic folder, is a sub-note and is never checked here.
 */
function isProjectHubPath(rel: string): boolean {
	const sub = rel.slice(ACTIVE_REL.length + 1);
	const parts = sub.split("/");
	if (parts.length === 1) return true;
	if (parts.length === 2) {
		const [topic, filename] = parts as [string, string];
		return filename.replace(/\.md$/i, "").toLowerCase() === topic.toLowerCase();
	}
	return false;
}

function findCompletedInActive(root: string): string[] {
	const found: string[] = [];
	for (const rel of walkMarkdown(root, ACTIVE_REL)) {
		if (!isProjectHubPath(rel)) continue;
		let content: string;
		try {
			content = readFileSync(join(root, rel), "utf-8");
		} catch {
			continue;
		}
		const status = extractFrontmatterField(content, "status");
		if (status && ARCHIVABLE_STATUS.has(status.toLowerCase())) {
			found.push(rel);
		}
	}
	return found.sort();
}

function findUngroupedClusters(root: string): TopicCluster[] {
	// Only files DIRECTLY in active/ root — anything already in a subfolder
	// is considered grouped.
	let entries: Dirent[];
	try {
		entries = readdirSync(join(root, ACTIVE_REL), { withFileTypes: true });
	} catch {
		return [];
	}
	// Sorted so token→file maps (and the signature dedup that keeps the
	// first token per file-set) are deterministic across filesystems.
	const rootFiles = entries
		.filter((e) => e.isFile() && isMarkdownFilename(e.name))
		.map((e) => e.name)
		.sort();

	// Don't nag about grouping when the root is already small — folders are
	// for taming size, not for ceremony.
	if (rootFiles.length < 4) return [];

	// token -> set of filenames containing it
	const byToken = new Map<string, Set<string>>();
	for (const f of rootFiles) {
		for (const t of new Set(titleTokens(f))) {
			(byToken.get(t) ?? byToken.set(t, new Set()).get(t)!).add(f);
		}
	}

	// A token is a groupable topic if it appears in >=2 root files but in no
	// more than half of them (the DF guard that rejects generic words).
	const dfCap = Math.floor(rootFiles.length / 2);
	const clusters: TopicCluster[] = [];
	const seenSignatures = new Set<string>();
	for (const [token, set] of byToken) {
		if (set.size < 2 || set.size > dfCap) continue;
		const files = [...set].sort();
		// Dedup tokens that produce the same file set.
		const sig = files.join("|");
		if (seenSignatures.has(sig)) continue;
		seenSignatures.add(sig);
		clusters.push({ token, files });
	}
	// Largest clusters first; ties broken by token for stable output.
	return clusters.sort(
		(a, b) => b.files.length - a.files.length || a.token.localeCompare(b.token),
	);
}

function findOversizedNotes(
	root: string,
	infraRootFilenames: readonly string[],
): OversizedNote[] {
	const out: OversizedNote[] = [];
	function walk(relDir: string): void {
		let entries: Dirent[];
		try {
			entries = readdirSync(join(root, relDir), { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const rel = relDir === "" ? e.name : `${relDir}/${e.name}`;
			if (e.isDirectory()) {
				if (relDir === "" && OVERSIZE_SKIP_DIRS.has(e.name)) continue;
				walk(rel);
			} else if (e.isFile() && isMarkdownFilename(e.name)) {
				if (isMonolithExempt(e.name)) continue;
				// Root-level infrastructure docs (README + translations,
				// CLAUDE.md, …) are repo files, not vault notes — their bulk
				// is not a split candidate.
				if (relDir === "" && isInfraFilename(e.name, infraRootFilenames))
					continue;
				try {
					const size = statSync(join(root, rel)).size;
					if (size >= MONOLITH_BYTES) {
						out.push({ path: rel, sizeKb: Math.round(size / 1000) });
					}
				} catch {
					/* unreadable → skip */
				}
			}
		}
	}
	walk("");
	return out.sort((a, b) => b.sizeKb - a.sizeKb);
}

// ---------------------------------------------------------------------------
// Meetings-inbox pressure. work/meetings/ is a staging inbox drained by
// /om-intake — raw exports sitting there are unprocessed by definition.
// ---------------------------------------------------------------------------

export const INBOX_PRESSURE_DAYS = 7;

const INBOX_REL = "work/meetings";

/**
 * The inbox's own README ships with the template and describes how to drain
 * the folder — /om-intake never processes it, so counting it made the flag
 * permanently unclearable (#155): it fired on a genuinely empty inbox and
 * the "oldest Nd" figure climbed forever, training the reader to ignore the
 * whole hygiene block.
 *
 * Matched as an exact path, not as any README: a README a user creates
 * inside a subfolder of their own is their content, and theirs to process.
 * Compared case-insensitively because the shipped `README.md` can arrive as
 * `readme.md` through a case-insensitive checkout.
 */
function isInboxScaffold(rel: string): boolean {
	return rel.toLowerCase() === `${INBOX_REL}/readme.md`;
}

function findInboxPressure(root: string, nowMs: number): InboxPressure | null {
	let count = 0;
	let oldestDays = 0;
	for (const rel of walkMarkdown(root, INBOX_REL)) {
		if (isInboxScaffold(rel)) continue;
		let mtimeMs: number;
		try {
			mtimeMs = statSync(join(root, rel)).mtimeMs;
		} catch {
			continue;
		}
		const ageDays = Math.floor((nowMs - mtimeMs) / 86_400_000);
		if (ageDays < INBOX_PRESSURE_DAYS) continue;
		count++;
		if (ageDays > oldestDays) oldestDays = ageDays;
	}
	return count > 0 ? { count, oldestDays } : null;
}

// ---------------------------------------------------------------------------
// Cross-repo memory inbox (#171). `memories/YYYY/MM/` is written by the MCP
// server on behalf of sessions in OTHER repos, and nothing has ever surfaced
// it. The meetings inbox above is watched; this one was not, so it accumulates
// in silence.
// ---------------------------------------------------------------------------

const MEMORY_ROOT_DEFAULT = "memories";

/**
 * Where the server writes cross-repo memories.
 *
 * NOT `mcp_inbox`, which is a different key for a different directory: the
 * fallback where a `record_work` call from a repo with no matching project
 * folder lands. Conflating the two is what left this unwatched, because the
 * watched one is empty by design in most vaults.
 */
export function parseMemoryRoot(manifestJson: string | null): string {
	if (manifestJson === null) return MEMORY_ROOT_DEFAULT;
	try {
		const declared = (JSON.parse(manifestJson) as Record<string, unknown>)["memory_root"];
		if (typeof declared === "string" && /^[\w.-]+$/.test(declared)) return declared;
	} catch {
		/* malformed manifest → the default */
	}
	return MEMORY_ROOT_DEFAULT;
}

/**
 * A capture already promoted into `brain/`, and kept on purpose.
 *
 * THE FLAG HAS TO BE ABLE TO REACH ZERO. Promotion is **additive**: the entry
 * stays, because `recall` reaches `brain/` only THROUGH a capture — an anchored
 * marker serves the promoted block, and there is no capture-independent path to
 * it — so deleting the capture would take the lesson away from every repo that
 * cannot read `brain/` at all. Counting every file therefore counts a number that only ever
 * grows, and a flag that cannot clear by doing the correct thing is precisely
 * the permanently-unclearable failure #155 already fixed once for the meetings
 * inbox.
 *
 * So promotion is recorded on the entry and a recorded entry stops being
 * pressure. This is the only edit a tool may make to a capture: the body, the
 * declared reach and the confidence are never touched.
 */
function promotionOf(root: string, rel: string): PromotedRef | null {
	let head: string;
	try {
		head = readFileSync(join(root, rel), "utf-8").slice(0, 2_000);
	} catch {
		return null;
	}
	const fm = head.match(/^---\n([\s\S]*?)\n---/);
	if (!fm) return null;
	// `parsePromotedMarker`, not a local regex. This was the third independent
	// parser of one format — `facetsOf` and `parsePromotedMarker` being the other
	// two — and the local one answered only "is there a marker", which is why the
	// count could not tell a servable promotion from a decorative one. (#183)
	const line = (fm[1] ?? "").match(/^promoted:\s*(.+)$/m);
	return line ? parsePromotedMarker(unquoteScalar(line[1]!.trim())) : null;
}

/** Undo the quoting the capture writer applies, so the parser sees the path. */
function unquoteScalar(s: string): string {
	if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
		return s.slice(1, -1);
	}
	return s;
}

/**
 * Captures awaiting review. Three deliberate differences from the meetings
 * inbox above.
 *
 * **No age threshold.** A capture is unreviewed because nobody has judged it
 * yet, and that is true the moment it lands. Waiting for it to go stale is how
 * a real inbox reached eighteen entries in a single day with nothing saying so.
 *
 * **Recursive.** The server writes `<root>/<YYYY>/<MM>/<title>.md`, so a flat
 * listing of the root finds nothing at all and is indistinguishable from a
 * drained inbox. `walkMarkdown` already handles this.
 *
 * **Promotion-aware**, for the reason in `isPromoted`: without it the count can
 * never fall, because the correct way to drain this inbox leaves every file
 * exactly where it is.
 */
function findMemoryInbox(root: string, relDir: string, nowMs: number): MemoryInboxPressure | null {
	let count = 0;
	let oldestDays = 0;
	let namedOnly = 0;
	for (const rel of walkMarkdown(root, relDir)) {
		// Same reasoning as the meetings scaffold (#155): a shipped README is not
		// a capture, and counting it makes the flag permanently unclearable.
		if (/\/readme\.md$/i.test(rel)) continue;
		const promoted = promotionOf(root, rel);
		if (promoted) {
			// Counted, never demanded. The inbox flag still falls on a bare marker —
			// forcing an anchor to clear hygiene would push anchors onto captures
			// whose promoted block is not fit to leave the vault. Reporting the split
			// makes the difference legible without making it mandatory. (#183)
			if (promoted.anchor === null) namedOnly++;
			continue;
		}
		let mtimeMs: number;
		try {
			mtimeMs = statSync(join(root, rel)).mtimeMs;
		} catch {
			continue;
		}
		count++;
		const ageDays = Math.floor((nowMs - mtimeMs) / 86_400_000);
		if (ageDays > oldestDays) oldestDays = ageDays;
	}
	// `count > 0` ALONE, deliberately. `namedOnly` never revives the flag: a store
	// whose captures are all promoted with bare markers is correctly drained, and
	// gating on it would rebuild the permanently-unclearable inbox that #155 fixed
	// and that the note on `promotionOf` exists to prevent. The split is a DETAIL
	// of a flag already firing; `health` reports it unconditionally, because health
	// is a report rather than a pressure. (#183)
	return count > 0 ? { count, oldestDays, namedOnly } : null;
}

// ---------------------------------------------------------------------------
// Team-shared subtree boundary (DEC-008, teeq). A project folder mirrored
// out via `git subtree push` to an external team repo must contain only
// content meant for that audience — a session work-log or an om
// `record_work` auto-capture landing at the folder root leaks to every
// subtree consumer the moment it's written, and neither of those write
// paths goes through this vault's own Write/Edit tools, so this can only
// ever be a NUDGE caught at the next scan, never a live block. Config-driven
// (`team_shared_roots` in vault-manifest.json) so a project opts in without
// a code change, and so the whitelist lives beside the data it protects
// instead of inside this file.
// ---------------------------------------------------------------------------

export type TeamSharedRoot = {
	readonly prefix: string; // vault-relative folder, e.g. "work/active/teeq"
	readonly allowDirs: ReadonlySet<string>; // subfolder names allowed directly under prefix
	readonly allowRootFiles: ReadonlySet<string>; // filenames allowed directly at prefix root
};

export type TeamSharedLeak = {
	readonly path: string; // vault-relative
	readonly root: string; // the prefix it violates
};

/** No default roots — this is project-specific and opt-in only via the manifest. */
export function parseTeamSharedRoots(manifestJson: string | null): readonly TeamSharedRoot[] {
	if (manifestJson === null) return [];
	try {
		const raw = (JSON.parse(manifestJson) as Record<string, unknown>)["team_shared_roots"];
		if (!Array.isArray(raw)) return [];
		const out: TeamSharedRoot[] = [];
		for (const entry of raw) {
			if (typeof entry !== "object" || entry === null) continue;
			const e = entry as Record<string, unknown>;
			const prefix = e["prefix"];
			const allowDirs = e["allow_dirs"];
			const allowRootFiles = e["allow_root_files"];
			if (
				typeof prefix !== "string" ||
				prefix.length === 0 ||
				prefix.startsWith("/") ||
				prefix.split("/").includes("..") ||
				!Array.isArray(allowDirs) ||
				!allowDirs.every((x): x is string => typeof x === "string") ||
				!Array.isArray(allowRootFiles) ||
				!allowRootFiles.every((x): x is string => typeof x === "string")
			) {
				continue; // malformed entry → skip it, not the whole config
			}
			out.push({
				prefix,
				allowDirs: new Set(allowDirs),
				allowRootFiles: new Set(allowRootFiles),
			});
		}
		return out;
	} catch {
		return [];
	}
}

/** Given a subtree-relative path (no leading slash), is it inside the whitelist? */
function isTeamSharedAllowed(sub: string, cfg: TeamSharedRoot): boolean {
	const slashIdx = sub.indexOf("/");
	return slashIdx === -1
		? cfg.allowRootFiles.has(sub)
		: cfg.allowDirs.has(sub.slice(0, slashIdx));
}

function findTeamSharedLeaks(root: string, roots: readonly TeamSharedRoot[]): TeamSharedLeak[] {
	const out: TeamSharedLeak[] = [];
	for (const cfg of roots) {
		for (const rel of walkMarkdown(root, cfg.prefix)) {
			const sub = rel.slice(cfg.prefix.length + 1);
			if (!isTeamSharedAllowed(sub, cfg)) out.push({ path: rel, root: cfg.prefix });
		}
	}
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function formatTeamSharedLeakHint(leak: TeamSharedLeak): string {
	return `🔒 \`${leak.path}\` sits directly under \`${leak.root}/\`, which is mirrored to a team-shared repo via \`git subtree push\`. If it isn't meant for the team (a session work-log, scratch, an om \`record_work\` auto-capture), move it to \`thinking/\`. If it belongs here, put it inside one of the allowed subfolders instead of the root.`;
}

/**
 * Write-time version: does the just-written file land outside the whitelist
 * of a configured team-shared root? Reuses the same allow-check as the scan
 * so write-time and scan-time can never disagree.
 */
export function newTeamSharedLeakCandidate(
	filePath: string,
	vaultRoot: string,
	roots: readonly TeamSharedRoot[],
): TeamSharedLeak | null {
	const normalized = filePath.replaceAll("\\", "/");
	const rootFwd = vaultRoot.replaceAll("\\", "/");
	for (const cfg of roots) {
		const prefixDir = `${rootFwd}/${cfg.prefix}/`;
		if (!normalized.startsWith(prefixDir)) continue;
		const sub = normalized.slice(prefixDir.length);
		if (!isTeamSharedAllowed(sub, cfg)) {
			return { path: `${cfg.prefix}/${sub}`, root: cfg.prefix };
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Write-time detectors — the same logic the scan uses, moved to the moment
// of write so drift is caught at the keystroke instead of the next session
// boundary. validate-write.ts calls these.
// ---------------------------------------------------------------------------

/**
 * Write-time cluster sensor: when the just-written note sits loose in the
 * active/ root and joins a distinctive-token cluster, return that cluster.
 * Reuses findUngroupedClusters wholesale — same tokenizer, same DF guard,
 * same small-root skip — so scan-time and write-time can never disagree.
 */
export function newNoteClusterCandidate(
	filePath: string,
	vaultRoot: string,
): TopicCluster | null {
	const normalized = filePath.replaceAll("\\", "/");
	const rootPrefix = `${vaultRoot.replaceAll("\\", "/")}/${ACTIVE_REL}/`;
	if (!normalized.startsWith(rootPrefix)) return null;
	const base = normalized.slice(rootPrefix.length);
	if (base.includes("/")) return null; // already in a topic folder
	for (const cluster of findUngroupedClusters(vaultRoot)) {
		if (cluster.files.includes(base)) return cluster;
	}
	return null;
}

export function formatClusterHint(cluster: TopicCluster): string {
	return [
		`🗂️  이 노트는 active/에서 "${cluster.token}" 토큰을 공유하는 다른 노트 ${cluster.files.length - 1}개와 같은 주제일 수 있습니다: ${cluster.files.join(", ")}.`,
		"규칙: 하나의 작업 흐름에 노트가 2개 이상이면 폴더로 묶습니다 (active/<Topic>/, `git mv`, 나중에 archive/에도 같은 폴더 구조 유지).",
		"토큰 겹침은 문맥을 판단하지 못합니다. 실제로 같은 맥락인지 확인한 뒤 묶고, 아니라면 그대로 진행하세요.",
	].join("\n");
}

export function formatMonolithHint(path: string, sizeBytes: number): string {
	return `📐 \`${path}\`이(가) 현재 ${Math.round(sizeBytes / 1000)}KB로 ${MONOLITH_BYTES / 1000}KB 정리 기준을 넘었습니다. 내용을 줄이지 말고 맥락이 남아 있을 때 분리하세요: 도메인 노트 / 이벤트 로그 위성 노트 / 클러스터 폴더로 원문 그대로 옮기고, 기존 파일에는 한 줄짜리 색인을 남긴 뒤 들어오는 링크를 새 위치로 연결합니다. 지금 분리하기 어렵다면 경고를 무시하지 말고 이번 세션에 그 이유를 남기세요.`;
}

export function scanActiveHygiene(
	root: string,
	nowMs: number = Date.now(),
	openLoopConfig: OpenLoopConfig = parseOpenLoopConfig(null),
	infraRootFilenames: readonly string[] = [],
	memoryRoot: string = MEMORY_ROOT_DEFAULT,
	teamSharedRoots: readonly TeamSharedRoot[] = [],
): ActiveHygieneReport {
	return {
		completedInActive: findCompletedInActive(root),
		ungroupedClusters: findUngroupedClusters(root),
		oversizedNotes: findOversizedNotes(root, infraRootFilenames),
		openLoops: findOpenLoops(root, nowMs, openLoopConfig),
		inboxPressure: findInboxPressure(root, nowMs),
		memoryInbox: findMemoryInbox(root, memoryRoot, nowMs),
		teamSharedLeaks: findTeamSharedLeaks(root, teamSharedRoots),
	};
}

/**
 * Render the report as markdown lines for hook output. Returns [] when the
 * vault is clean, so callers can skip emitting a section entirely.
 */
export function formatActiveHygiene(report: ActiveHygieneReport): string[] {
	const {
		completedInActive,
		ungroupedClusters,
		oversizedNotes,
		openLoops,
		inboxPressure,
		memoryInbox,
		teamSharedLeaks,
	} = report;
	if (
		completedInActive.length === 0 &&
		ungroupedClusters.length === 0 &&
		oversizedNotes.length === 0 &&
		openLoops.length === 0 &&
		inboxPressure === null &&
		memoryInbox === null &&
		teamSharedLeaks.length === 0
	) {
		return [];
	}
	const lines: string[] = [];

	if (completedInActive.length > 0) {
		lines.push(
			`⚠️  완료 상태인데 아직 active/에 남아 있는 노트가 ${completedInActive.length}개 있습니다. archive/YYYY/로 옮기세요 (/om-project-archive 사용 가능):`,
		);
		for (const p of completedInActive) lines.push(`   - ${p}`);
	}

	if (ungroupedClusters.length > 0) {
		if (lines.length > 0) lines.push("");
		lines.push(
			"⚠️  active/의 여러 노트가 하나의 주제로 보입니다. 폴더로 묶는 것을 검토하세요 (active/<Topic>/):",
		);
		for (const { token, files } of ungroupedClusters) {
			lines.push(`   - "${token}": ${files.join(", ")}`);
		}
	}

	if (oversizedNotes.length > 0) {
		if (lines.length > 0) lines.push("");
		lines.push(
			`⚠️  ${MONOLITH_BYTES / 1000}KB 정리 기준을 넘은 노트가 ${oversizedNotes.length}개 있습니다. 내용을 줄이지 말고 분리하세요 (도메인 노트 / 이벤트 로그 위성 노트 / 클러스터 폴더로 원문 그대로 이동하고 기존 파일에는 한 줄짜리 색인 유지):`,
		);
		for (const { path, sizeKb } of oversizedNotes) {
			lines.push(`   - ${path} (${sizeKb}KB)`);
		}
	}

	if (openLoops.length > 0) {
		if (lines.length > 0) lines.push("");
		lines.push(
			`⚠️  미완료 후속 작업이 ${OPEN_LOOP_DAYS}일 넘게 갱신되지 않은 노트가 ${openLoops.length}개 있습니다. 완료하거나, 후속 조치하거나, 의도적으로 보류하세요 (경로와 개수만 표시):`,
		);
		for (const { path, ageDays, openItems } of openLoops) {
			lines.push(`   - ${path} (${ageDays}d, ${openItems} open item(s))`);
		}
	}

	if (inboxPressure !== null) {
		if (lines.length > 0) lines.push("");
		lines.push(
			`⚠️  work/meetings/에 ${INBOX_PRESSURE_DAYS}일 넘게 남아 있는 원본 내보내기가 ${inboxPressure.count}개 있습니다 (가장 오래된 항목 ${inboxPressure.oldestDays}일). /om-intake로 수신함을 처리하세요.`,
		);
	}

	// Count and oldest only, never the file list. This inbox is meant to hold
	// captures between sessions, so enumerating it every session would train the
	// reader to skip the whole block.
	if (memoryInbox !== null) {
		if (lines.length > 0) lines.push("");
		lines.push(
			`⚠️  검토를 기다리는 저장소 간 메모리 캡처가 ${memoryInbox.count}개 있습니다 (가장 오래된 항목 ${memoryInbox.oldestDays}일). 오래 남길 내용은 적절한 brain/ 노트로 복사하고, 캡처 frontmatter에 복사한 블록을 가리키는 \`promoted: "brain/Note#^om-a1b2c3"\`를 추가하세요. recall은 캡처를 통해서만 brain/ 내용에 도달하므로 원본 캡처는 삭제하지 않습니다. 앵커가 있어야 수정된 내용을 recall이 제공할 수 있으며, \`promoted: <note>\`처럼 노트만 지정하면 대기 개수에서는 빠지지만 내용은 제공되지 않습니다.`,
		);
		// Evidence for the sentence above, from this vault rather than in the
		// abstract. Told once the flag is already firing — it never raises one of
		// its own, because a bare marker is a legitimate promotion. (#183)
		if (memoryInbox.namedOnly > 0) {
			lines.push(
				`   이미 승격된 캡처 ${memoryInbox.namedOnly}개는 앵커 없는 표식만 있어 recall이 내용을 제공하지 못합니다. 복사한 블록의 앵커를 추가해 다시 연결하세요.`,
			);
		}
	}

	if (teamSharedLeaks.length > 0) {
		if (lines.length > 0) lines.push("");
		lines.push(
			`🔒 팀 공유 subtree 루트의 허용 목록 밖에 있는 파일이 ${teamSharedLeaks.length}개 있습니다. 다음 \`git subtree push\` 때 그대로 팀 저장소에 올라갑니다:`,
		);
		for (const { path, root } of teamSharedLeaks) {
			lines.push(`   - ${path} (root: ${root}/)`);
		}
		lines.push(
			"   Move anything here that isn't meant for the team (session work-logs, scratch, om record_work captures) to `thinking/`.",
		);
	}

	return lines;
}
