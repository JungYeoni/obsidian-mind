#!/usr/bin/env node
/**
 * UserPromptSubmit hook — remind the agent to call the `om` MCP tools at the
 * moments this vault documents as reliable triggers: an explicit study or
 * benchmarking request, or a sign the user didn't follow the last
 * explanation. A written instruction alone gets skipped once a nearer task
 * exists (the asymmetry this vault's own CLAUDE.md warns about); this hook
 * is the deterministic half — it can only remind, not write the memory
 * itself, since composing a good `remember` call needs judgment a regex
 * can't do.
 *
 * Wired into consuming repos by absolute path (same shim pattern as
 * om-mcp.mjs / qmd-mcp.mjs) — never edit a copy in a consuming repo, fix it
 * here.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { debug, readStdinJson, writeHookOutput } from "./lib/hook-io.ts";
import { anyWordMatch } from "./lib/matcher.ts";
import { parseHintState, prune, record, unseen } from "./lib/hint-state.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// Deliberately its own file, not classify-message's .hint-state.json: this
// hook's session_id namespace is shared across every consuming repo (they
// all point at this same script by absolute path), and mixing it with the
// vault's own per-session dedupe would be one more thing to reason about
// for no benefit.
const STATE_PATH =
	process.env["OM_TRIGGER_HINT_STATE"] ?? join(SCRIPT_DIR, ".om-trigger-hint-state.json");

const TRIGGERS: ReadonlyArray<{ name: string; patterns: readonly string[]; message: string }> = [
	{
		name: "om-study-request",
		patterns: ["공부", "배울", "배워", "Learning Debt", "학습부채", "스터디"],
		message:
			"om 학습요청 신호 감지 — 답변을 끝낸 뒤 그 결과를 `remember`로 기록한다 (scope: project).",
	},
	{
		name: "om-confusion-signal",
		patterns: [
			"다시 설명",
			"다시 말해",
			"이해가 안",
			"이해 안",
			"뭔말이야",
			"뭔 말이야",
			"무슨 말이야",
			"무슨 뜻",
			"뭔 소리",
			"뭔소리",
		],
		message:
			"om 이해공백 신호 감지 — 재설명하고 난 뒤, 어떤 개념을 이해 못 했는지와 재설명 내용을 `remember`로 기록한다.",
	},
];

type HookInput = {
	readonly prompt?: unknown;
	readonly hook_event_name?: unknown;
	readonly session_id?: unknown;
};

const input = await readStdinJson<HookInput>();
if (!input) {
	debug("om-trigger-hint: null input (bad/empty stdin)");
	process.exit(0);
}

const prompt = input.prompt;
if (typeof prompt !== "string" || !prompt) {
	debug(`om-trigger-hint: no usable prompt (type=${typeof prompt})`);
	process.exit(0);
}

const matched = TRIGGERS.filter((t) => anyWordMatch(t.patterns, prompt));
debug(`om-trigger-hint: matched ${matched.length} trigger(s)`);

// Once-per-session dedupe, same reasoning as classify-message: a long
// session would otherwise pay the same hint every time the phrase recurs.
// Missing/invalid session_id fails open (all hints fire).
let toEmit = matched;
const sessionId = input.session_id;
if (typeof sessionId === "string" && sessionId && matched.length > 0) {
	let state = parseHintState(null);
	try {
		state = parseHintState(readFileSync(STATE_PATH, { encoding: "utf-8" }));
	} catch {
		/* missing/unreadable state → empty (fail open) */
	}
	const names = matched.map((t) => t.name);
	const unseenNames = new Set(unseen(state, sessionId, names));
	toEmit = matched.filter((t) => unseenNames.has(t.name));
	if (toEmit.length > 0) {
		try {
			const now = new Date();
			const next = prune(
				record(state, sessionId, toEmit.map((t) => t.name), now.toISOString()),
				now.getTime(),
			);
			writeFileSync(STATE_PATH, JSON.stringify(next));
		} catch {
			/* best-effort — a failed state write must never block the hint */
		}
	}
}

if (toEmit.length > 0) {
	const additionalContext =
		"om MCP trigger hint (this repo is vault-connected):\n" +
		toEmit.map((t) => `- ${t.message}`).join("\n");

	const eventName =
		typeof input.hook_event_name === "string" ? input.hook_event_name : "UserPromptSubmit";

	writeHookOutput(eventName, additionalContext);
}

process.exit(0);
