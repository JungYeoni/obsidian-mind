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
import sys
from pathlib import Path

VAULT_ROOT = Path(__file__).resolve().parent.parent


def resolve_infra_paths(manifest: dict) -> list[Path]:
    """Expand each `infrastructure` entry (exact file or `dir/**` glob) into
    the real files currently on disk, skipping entries that don't exist."""
    resolved: list[Path] = []
    for entry in manifest["infrastructure"]:
        if entry.endswith("/**"):
            base = VAULT_ROOT / entry[:-3]
            if base.is_dir():
                resolved.extend(p for p in base.rglob("*") if p.is_file())
        elif "*" in entry:
            resolved.extend(VAULT_ROOT.glob(entry))
        else:
            p = VAULT_ROOT / entry
            if p.is_file():
                resolved.append(p)
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
