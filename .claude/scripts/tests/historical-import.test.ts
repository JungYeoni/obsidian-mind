import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateHistoricalDocument } from "../lib/historical-import.ts";
import { resolveExposure } from "../lib/mcp-exposure.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const hub = `---
date: 2026-09-24
description: historical project
type: historical-project
status: completed
lifecycle: archived
project: old-app
display_name: Old App
completed: 2023
imported: 2026-09-24
reconstruction_status: reviewed
source_manifest: imports/historical/old-app/manifest.md
tags: [work-note, historical-project]
---
# Old App
## Reuse Notes
[[Work Notes]]
`;

describe("Historical Import validation", () => {
	test("accepts an archived hub whose year and identity are evidenced", () => {
		assert.deepEqual(validateHistoricalDocument("work/archive/2023/old-app/old-app.md", hub), []);
	});

	test("rejects a whole-hub confidence and active-style handoff", () => {
		const bad = hub.replace("status: completed", "status: completed\nconfidence: mixed").replace("## Reuse Notes", "## Handoff");
		const warnings = validateHistoricalDocument("work/archive/2023/old-app/old-app.md", bad);
		assert.ok(warnings.some((w) => w.includes("Hub 전체")));
		assert.ok(warnings.some((w) => w.includes("Reuse Notes")));
	});

	test("rejects an archive year that does not match completed", () => {
		const warnings = validateHistoricalDocument("work/archive/2024/old-app/old-app.md", hub);
		assert.ok(warnings.some((w) => w.includes("archive 연도")));
	});

	test("requires source and confidence on candidate claims", () => {
		const candidate = `---\ndate: 2026-09-24\ndescription: candidates\ntype: historical-import-candidates\nproject: old-app\nstatus: review-needed\n---\n# Candidates\n`;
		const warnings = validateHistoricalDocument("imports/historical/old-app/extracted/decision-candidates.md", candidate);
		assert.ok(warnings.some((w) => w.includes("source")));
		assert.ok(warnings.some((w) => w.includes("confidence")));
	});

	test("raw preserved sources are not interpreted as vault notes", () => {
		assert.deepEqual(validateHistoricalDocument("imports/historical/old-app/raw/transcripts/chat.md", "raw export"), []);
	});

	test("the shipped vault excludes imports from QMD and om MCP", () => {
		const app = JSON.parse(readFileSync(join(ROOT, ".obsidian/app.json"), "utf8")) as { userIgnoreFilters?: string[] };
		assert.ok(app.userIgnoreFilters?.includes("imports/"));

		const manifest = JSON.parse(readFileSync(join(ROOT, "vault-manifest.json"), "utf8")) as Record<string, unknown>;
		const policy = resolveExposure(ROOT, manifest, String(manifest.memory_root ?? "memories"));
		assert.ok(!policy.roots.some((root) => root === "imports" || root.startsWith("imports/")));
	});
});
