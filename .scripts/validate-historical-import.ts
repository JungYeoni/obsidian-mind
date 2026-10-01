#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { validateHistoricalDocument } from "../.claude/scripts/lib/historical-import.ts";

const identity = process.argv[2]?.trim();
if (!identity || !/^[\w.-]+$/.test(identity)) {
	process.stderr.write("Usage: validate-historical-import.ts <machine-identity>\n");
	process.exit(2);
}

const roots = [join("imports", "historical", identity), join("work", "archive")];
const files: string[] = [];
for (const root of roots) walk(root, files);

let failures = 0;
for (const file of files) {
	const rel = relative(process.cwd(), file).replaceAll("\\", "/");
	if (!rel.startsWith(`imports/historical/${identity}/`) && !rel.match(new RegExp(`^work/archive/\\d{4}/${identity}/`))) continue;
	const warnings = validateHistoricalDocument(rel, readFileSync(file, "utf8"));
	for (const warning of warnings) {
		process.stderr.write(`${rel}: ${warning}\n`);
		failures++;
	}
}

if (!existsSync(roots[0])) {
	process.stderr.write(`staging project not found: ${roots[0]}\n`);
	process.exit(2);
}

if (failures) {
	process.stderr.write(`Historical Import validation failed: ${failures} issue(s).\n`);
	process.exit(1);
}

process.stdout.write(`Historical Import validation passed: ${identity} (${files.length} file(s) inspected).\n`);

function walk(dir: string, out: string[]): void {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
	}
}

