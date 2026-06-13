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
      const preludeExists = await fsp
        .lstat(path.join(root, "prelude"))
        .then(() => true)
        .catch(() => false);
      const preludeFileExists = await pathExists(path.join(root, "prelude", "prelude.bzl"));
      const rootCfgExists = await pathExists(path.join(root, ".buckconfig"));
      const toolCfgExists = await pathExists(path.join(root, "toolchains", ".buckconfig"));
      if (preludeExists && preludeFileExists && rootCfgExists && toolCfgExists) {
        return;
      }
    } catch {}

    let preludePath = "";
    try {
      const { stdout } = await $({
        stdio: "pipe",
        cwd: root,
      })`nix build .#buck2-prelude --no-link --no-write-lock-file --accept-flake-config --print-out-paths`;
      const out = String(stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop();
      if (!out) throw new Error("unable to build .#buck2-prelude");
      preludePath = `${out}/prelude`;
    } catch {
      try {
        const { stdout } = await $({
          stdio: "pipe",
          cwd: root,
        })`nix eval --raw .#inputs.buck2.outPath`;
        const out = String(stdout || "").trim();
        if (!out) throw new Error("unable to eval .#inputs.buck2.outPath");
        preludePath = `${out}/prelude`;
      } catch {
        preludePath = path.join(root, "prelude");
      }
    }

    await $({ cwd: root })`bash --noprofile --norc -c ${`set -euo pipefail
      printf '.\n' > .buckroot
      mkdir -p .viberoots
      [ -e .viberoots/current ] || ln -s .. .viberoots/current
      rm -rf prelude && ln -s "${preludePath}" prelude
      cat > .buckconfig <<'EOF'
[buildfile]
name = TARGETS

[repositories]
root = .
viberoots = ./.viberoots/current
prelude = ./prelude
toolchains = ./toolchains
repo_toolchains = ./toolchains
fbsource = ./prelude/third-party/fbsource_stub
fbcode = ./prelude/third-party/fbcode_stub
config = ./prelude

[cells]
root = .
viberoots = ./.viberoots/current
prelude = ./prelude
toolchains = ./toolchains
repo_toolchains = ./toolchains
fbsource = ./prelude/third-party/fbsource_stub
fbcode = ./prelude/third-party/fbcode_stub
config = ./prelude

[build]
prelude = prelude
user_platform = prelude//platforms:default
target_platforms = prelude//platforms:default
EOF
    `}`;

    await $({ cwd: root })`bash --noprofile --norc -c ${`set -euo pipefail
      mkdir -p toolchains
      cat > toolchains/.buckconfig <<'EOF'
[buildfile]
name = TARGETS
EOF
    `}`;
  } catch (e) {
    console.error("failed to ensure Buck prelude config:", e);
    throw e;
  }
}
