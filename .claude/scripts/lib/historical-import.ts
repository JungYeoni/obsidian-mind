import { basename } from "node:path";

function frontmatter(content: string): Record<string, string> {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	const out: Record<string, string> = {};
	for (const line of (match[1] ?? "").split(/\r?\n/)) {
		const field = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
		if (!field) continue;
		out[field[1]!] = (field[2] ?? "").trim().replace(/^['"]|['"]$/g, "");
	}
	return out;
}

function requireFields(fm: Record<string, string>, fields: readonly string[], warnings: string[]): void {
	for (const field of fields) {
		if (!fm[field]) warnings.push(`필수 frontmatter 누락: ${field}`);
	}
}

function requireText(content: string, pattern: RegExp, message: string, warnings: string[]): void {
	if (!pattern.test(content)) warnings.push(message);
}

/** Historical Import v1의 staging 및 archive 발행 규칙을 검사한다. */
export function validateHistoricalDocument(relPath: string, content: string): string[] {
	const rel = relPath.replaceAll("\\", "/");
	const warnings: string[] = [];
	const fm = frontmatter(content);
	const staging = rel.match(/^imports\/historical\/([^/]+)\/(.+)$/);
	const archived = rel.match(/^work\/archive\/(\d{4})\/([^/]+)\/([^/]+)\.md$/);

	if (!staging && !archived) return warnings;
	if (rel.includes("/raw/")) return warnings;

	if (staging) {
		const [, identity, tail] = staging;
		if (tail === "manifest.md") {
			requireFields(fm, ["date", "description", "type", "project", "display_name", "status", "imported"], warnings);
			if (fm.type !== "historical-import") warnings.push("manifest type은 historical-import여야 한다");
			if (fm.project && fm.project !== identity) warnings.push(`manifest project는 staging identity(${identity})와 같아야 한다`);
			if (fm.target && !new RegExp(`^work/archive/\\d{4}/${identity}/$`).test(fm.target)) {
				warnings.push(`target은 work/archive/<year>/${identity}/ 형식이어야 한다`);
			}
			requireText(content, /^## Repository References$/m, "Repository References 섹션이 필요하다", warnings);
			requireText(content, /^- Path:/m, "repository Path를 기록해야 한다", warnings);
			requireText(content, /^- Remote:/m, "repository Remote를 기록해야 한다", warnings);
			requireText(content, /^- Branch or tag:/m, "repository branch 또는 tag를 기록해야 한다", warnings);
			requireText(content, /^- Commit SHA:/m, "repository commit SHA를 기록해야 한다", warnings);
			return warnings;
		}

		if (tail === "draft/project-hub.md") {
			validateHub(identity!, null, fm, content, warnings);
			return warnings;
		}

		if (tail.startsWith("extracted/")) {
			requireFields(fm, ["date", "description", "type", "project", "status"], warnings);
			if (fm.project && fm.project !== identity) warnings.push(`project는 staging identity(${identity})와 같아야 한다`);
			if (basename(tail) === "timeline.md") {
				requireText(content, /\|\s*Source\s*\|\s*Confidence\s*\|/i, "timeline에는 Source와 Confidence 열이 필요하다", warnings);
			} else {
				requireText(content, /^- (?:Context source|Source|Evidence of insufficient understanding):/m, "각 후보 또는 사실에 source 항목이 필요하다", warnings);
				requireText(content, /^- Confidence:/m, "각 후보 또는 사실에 confidence 항목이 필요하다", warnings);
			}
			return warnings;
		}
	}

	if (archived) {
		const [, year, identity, file] = archived;
		if (file === identity) validateHub(identity!, year!, fm, content, warnings);
	}
	return warnings;
}

function validateHub(
	identity: string,
	year: string | null,
	fm: Record<string, string>,
	content: string,
	warnings: string[],
): void {
	requireFields(
		fm,
		["date", "description", "type", "status", "lifecycle", "project", "display_name", "imported", "reconstruction_status", "source_manifest"],
		warnings,
	);
	if (fm.type !== "historical-project") warnings.push("Historical Project Hub type은 historical-project여야 한다");
	if (fm.status !== "completed") warnings.push("Historical Project Hub status는 completed여야 한다");
	if (fm.lifecycle !== "archived") warnings.push("Historical Project Hub lifecycle은 archived여야 한다");
	if (fm.project && fm.project !== identity) warnings.push(`project는 project identity(${identity})와 같아야 한다`);
	if (Object.hasOwn(fm, "confidence")) warnings.push("Hub 전체에 confidence를 두지 말고 개별 주장에 기록한다");
	requireText(content, /^## Reuse Notes$/m, "Historical Project Hub에는 Reuse Notes 섹션이 필요하다", warnings);
	if (/^## Handoff$/m.test(content)) warnings.push("Historical Project Hub에서는 Handoff 대신 Reuse Notes를 사용한다");
	if (year && fm.completed !== year) warnings.push(`completed는 archive 연도(${year})와 같아야 한다`);
}

