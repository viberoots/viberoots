import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const repoRoot = process.cwd();
export const scratchRoot = path.join(repoRoot, "buck-out", "tmp");
export const externalScratchRoot = path.join(os.tmpdir(), "viberoots-agent-wrapper-tests");

export async function writeExecutable(file: string, text: string): Promise<void> {
  await fsp.writeFile(file, text, "utf8");
  await fsp.chmod(file, 0o755);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function safehouseNixReadOnlyPattern(): string {
  return "/nix/store:/var/run/nix-daemon\\.socket(?::/nix/var/nix/daemon-socket/socket)?(?::/etc/nix)?(?::/private/var/run/nix-daemon\\.socket)?(?::/(?:private/)?etc/bashrc)*(?::/(?:private/)?etc/profile)*(?::/(?:private/)?etc/static/bashrc)*(?::/private/etc/nix)?(?::/(?:private/)?var/db/xcode_select_link)*(?::[^ ]+)?";
}

export function safehouseLaunchPattern(worktreeRealRoot: string): string {
  return `safehouse --workdir=${escapeRegExp(worktreeRealRoot)}(?: --add-dirs=[^ ]+)? --add-dirs-ro=${safehouseNixReadOnlyPattern()}(?: --add-dirs-ro=[^ ]+/\\.ssh/known_hosts)? --append-profile=.* --env `;
}

export async function makeFakeAgentTools(
  tmp: string,
  gitRoot: string,
  toolName: "claude" | "codex",
): Promise<{ bin: string; log: string }> {
  const bin = path.join(tmp, "bin");
  const log = path.join(tmp, "calls.log");
  const safehouseEnv =
    toolName === "claude" ? "VBR_CLAUDE_SAFEHOUSE_ACTIVE" : "VBR_CODEX_SAFEHOUSE_ACTIVE";
  await fsp.mkdir(bin, { recursive: true });
  await writeExecutable(
    path.join(bin, "git"),
    `#!/usr/bin/env bash
if [ "$1" = "-C" ]; then
  workdir="$2"
  shift 2
  if [ "$1" = "rev-parse" ] && [ "$2" = "--is-inside-work-tree" ]; then
    [ -e "$workdir/.git" ]
    exit $?
  fi
  if [ "$1" = "status" ]; then
    if [ -e "$workdir/AUTOGEN_ONLY" ]; then
      printf ' M third_party/providers/TARGETS\\0 M .viberoots/workspace/providers/auto_map.bzl\\0'
    elif [ -e "$workdir/REAL_DIRTY" ]; then
      printf ' M README.md\\0'
    fi
    exit 0
  fi
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then
  case "$(pwd -P)" in
    */.claude/worktrees/*|*/.codex/worktrees/*)
      pwd -P
      exit 0
      ;;
  esac
  printf '%s\\n' "${gitRoot}"
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--verify" ]; then
  case "\${4:-}" in
    refs/heads/worktree-branch-only|refs/heads/worktree-remove-me|refs/heads/worktree-alpha|refs/heads/worktree-beta)
      exit 0
      ;;
  esac
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--verify" ]; then
  exit 1
fi
if [ "$1" = "worktree" ] && [ "$2" = "add" ]; then
  printf 'git %s\\n' "$*" >> "${log}"
  target=""
  skip_next=0
  for arg in "$@"; do
    if [ "$skip_next" = 1 ]; then
      skip_next=0
      continue
    fi
    case "$arg" in
      worktree|add|HEAD|origin/HEAD) ;;
      -b|-B|--reason)
        skip_next=1
        ;;
      -*)
        ;;
      *)
        target="$arg"
        ;;
    esac
    if [ -n "$target" ]; then
      break
    fi
  done
  mkdir -p "$target"
  if [ -e "${gitRoot}/node_modules" ]; then
    ln -s "${gitRoot}/node_modules" "$target/node_modules"
  fi
  printf 'gitdir: fake\\n' > "$target/.git"
  exit 0
fi
if [ "$1" = "worktree" ] && [ "$2" = "remove" ]; then
  printf 'git %s\\n' "$*" >> "${log}"
  force=0
  target=""
  for arg in "$@"; do
    case "$arg" in
      --force)
        force=1
        ;;
      worktree|remove)
        ;;
      *)
        target="$arg"
        ;;
    esac
  done
  if [ -e "$target/REAL_DIRTY" ] && [ "$force" = 0 ]; then
    exit 13
  fi
  rm -rf "$target"
  exit 0
fi
if [ "$1" = "worktree" ] && [ "$2" = "prune" ]; then
  printf 'git %s\\n' "$*" >> "${log}"
  exit 0
fi
if [ "$1" = "branch" ] && [ "$2" = "-D" ]; then
  printf 'git %s\\n' "$*" >> "${log}"
  exit 0
fi
`,
  );
  await writeExecutable(
    path.join(bin, toolName),
    `#!/usr/bin/env bash
printf '${toolName} %s\\n' "$*" >> "${log}"
printf '${safehouseEnv}=%s\\n' "\${${safehouseEnv}:-}" >> "${log}"
printf 'HOME=%s\\n' "\${HOME:-}" >> "${log}"
printf 'CODEX_HOME=%s\\n' "\${CODEX_HOME:-}" >> "${log}"
printf 'CLAUDE_CONFIG_DIR=%s\\n' "\${CLAUDE_CONFIG_DIR:-}" >> "${log}"
`,
  );
  await writeExecutable(
    path.join(bin, "safehouse"),
    `#!/usr/bin/env bash
printf 'safehouse %s\\n' "$*" >> "${log}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --append-profile=*)
      profile="\${1#--append-profile=}"
      printf 'append-profile-begin\\n' >> "${log}"
      cat "$profile" >> "${log}" 2>/dev/null || true
      printf 'append-profile-end\\n' >> "${log}"
      shift
      ;;
    --append-profile)
      profile="\${2:-}"
      printf 'append-profile-begin\\n' >> "${log}"
      cat "$profile" >> "${log}" 2>/dev/null || true
      printf 'append-profile-end\\n' >> "${log}"
      shift 2
      ;;
    --workdir=*|--add-dirs=*|--add-dirs-ro=*|--env) shift ;;
    --workdir|--add-dirs|--add-dirs-ro) shift 2 ;;
    *) exec "$@" ;;
  esac
done
`,
  );
  return { bin, log };
}
