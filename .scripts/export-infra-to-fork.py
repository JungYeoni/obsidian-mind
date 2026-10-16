#!/usr/bin/env python3
"""Sync vault-manifest.json's `infrastructure` file list into a separate
local clone of the obsidian-mind fork, so code/config customizations can be
published without ever touching personal vault content (notes live outside
this list entirely).

Usage:
    python3 .scripts/export-infra-to-fork.py <path-to-fork-clone>

Does not commit or push — review `git status`/`git diff` in the fork clone
and do that yourself.
"""

import fnmatch
import json
import shutil
import subprocess
import sys
from pathlib import Path

VAULT_ROOT = Path(__file__).resolve().parent.parent


def tracked_files() -> set[str]:
    """Vault files git tracks. Gitignored runtime state inside infra folders
    (om-mcp-audit.jsonl, om-reasoning/, settings.local.json, hint state) must
    never reach the public fork, so only tracked files are export candidates."""
    out = subprocess.run(["git", "ls-files", "-z"], cwd=VAULT_ROOT, check=True,
                         capture_output=True).stdout.decode("utf-8")
    return {p for p in out.split("\0") if p}


# ShardMind's per-install state (which release this vault is on, file hashes)
# and its cached copy of the release are about THIS vault, not the template
# fork — a fork carrying them would look like an already-managed install.
# Home.md is this vault's personal dashboard: it links notes that exist only
# here (Learning Index, Reference Index, School), which the fork's wikilink
# ratchet test reads as broken. The fork keeps the template's own Home.md.
EXPORT_EXCLUDE_PREFIXES = (".shardmind/state.json", ".shardmind/templates/", ".shardmind/backups/", "Home.md")


def resolve_infra_paths(manifest: dict) -> list[Path]:
    """Expand each `infrastructure` entry (exact file, `dir/**` or glob) into
    tracked vault files, skipping entries that don't exist."""
    tracked = tracked_files()
    resolved: list[Path] = []
    for entry in manifest["infrastructure"]:
        if entry.endswith("/**"):
            prefix = entry[:-2]
            matches = [p for p in tracked if p.startswith(prefix)]
        else:
            matches = [p for p in tracked if fnmatch.fnmatchcase(p, entry)]
        matches = [p for p in matches if not p.startswith(EXPORT_EXCLUDE_PREFIXES)]
        resolved.extend(VAULT_ROOT / p for p in matches if (VAULT_ROOT / p).is_file())
    return resolved


def main() -> None:
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    fork_root = Path(sys.argv[1]).resolve()
    if not (fork_root / ".git").is_dir():
        print(f"error: {fork_root} is not a git repo", file=sys.stderr)
        sys.exit(1)

    manifest = json.loads((VAULT_ROOT / "vault-manifest.json").read_text(encoding="utf-8"))
    files = resolve_infra_paths(manifest)

    copied = 0
    for src in files:
        rel = src.relative_to(VAULT_ROOT)
        dst = fork_root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1

    print(f"copied {copied} infrastructure file(s) into {fork_root}")
    print("next: cd into it, `git status` / `git diff` to review, then commit + push")


if __name__ == "__main__":
    main()
