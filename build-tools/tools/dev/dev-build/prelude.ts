import * as fsp from "node:fs/promises";
import path from "node:path";
import { applyNixCacheHealthPolicy } from "../verify/nix-cache-health";
async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureBuckPreludeConfig(root: string): Promise<void> {
  try {
    await applyNixCacheHealthPolicy(root);
    try {
      const preludeFileExists = await pathExists(
        path.join(root, ".viberoots", "current", "prelude", "prelude.bzl"),
      );
      const rootCfgExists = await pathExists(path.join(root, ".buckconfig"));
      const workspaceProvidersCfgExists = await pathExists(
        path.join(root, ".viberoots", "workspace", "providers", ".buckconfig"),
      );
      const workspaceBuckCfgExists = await pathExists(
        path.join(root, ".viberoots", "workspace", "buck", ".buckconfig"),
      );
      const workspaceTargetsExists = await pathExists(
        path.join(root, ".viberoots", "workspace", "TARGETS"),
      );
      if (
        preludeFileExists &&
        rootCfgExists &&
        workspaceProvidersCfgExists &&
        workspaceBuckCfgExists &&
        workspaceTargetsExists
      ) {
        return;
      }
    } catch {}

    await $({ cwd: root })`bash --noprofile --norc -c ${`set -euo pipefail
      printf '.\n' > .buckroot
      mkdir -p .viberoots
      [ -e .viberoots/current ] || ln -s ../viberoots .viberoots/current
      mkdir -p .viberoots/workspace/providers .viberoots/workspace/buck
      cat > .buckconfig <<'EOF'
[buildfile]
name = TARGETS

[repositories]
root = .
viberoots = ./.viberoots/current
prelude = ./.viberoots/current/prelude
toolchains = ./.viberoots/current/toolchains
repo_toolchains = ./.viberoots/current/toolchains
fbsource = ./.viberoots/current/config/fbsource_stub
fbcode = ./.viberoots/current/config/fbcode_stub
config = ./.viberoots/current/prelude
workspace_providers = ./.viberoots/workspace/providers
workspace_buck = ./.viberoots/workspace/buck

[cells]
root = .
viberoots = ./.viberoots/current
prelude = ./.viberoots/current/prelude
toolchains = ./.viberoots/current/toolchains
repo_toolchains = ./.viberoots/current/toolchains
fbsource = ./.viberoots/current/config/fbsource_stub
fbcode = ./.viberoots/current/config/fbcode_stub
config = ./.viberoots/current/prelude
workspace_providers = ./.viberoots/workspace/providers
workspace_buck = ./.viberoots/workspace/buck

[build]
prelude = prelude
user_platform = prelude//platforms:default
target_platforms = prelude//platforms:default

[project]
ignore = .viberoots/buck/tmp,.viberoots/workspace/buck/tmp,.claude/worktrees,.codex/worktrees
EOF
    `}`;

    await $({ cwd: root })`bash --noprofile --norc -c ${`set -euo pipefail
      cat > .viberoots/workspace/providers/.buckconfig <<'EOF'
[buildfile]
name = TARGETS
EOF
      cat > .viberoots/workspace/buck/.buckconfig <<'EOF'
[buildfile]
name = TARGETS
EOF
      cat > .viberoots/workspace/TARGETS <<'EOF'
filegroup(
    name = "flake.lock",
    srcs = ["flake.lock"],
    visibility = ["PUBLIC"],
)
EOF
    `}`;
  } catch (e) {
    console.error("failed to ensure Buck prelude config:", e);
    throw e;
  }
}
