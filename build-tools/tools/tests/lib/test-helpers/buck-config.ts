import * as fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GRAPH_PATH, WORKSPACE_BUCK_STATE_DIR } from "../../../lib/workspace-state-paths";
import { BUCK_PROJECT_IGNORE_LINE } from "../../../lib/buck-project-ignore";
import { readGlobalNixInputTargets } from "../../../lib/global-nix-input-targets";
import "./worker-init";
let cachedPreludePath: Promise<string> | null = null;
interface TempRepoBuckConfigOptions {
  viberootsInputRoot?: string;
  viberootsSourceRoot?: string;
}

async function hasPreludeEntrypoint(preludePath: string): Promise<boolean> {
  if (!preludePath) return false;
  try {
    await fsp.access(path.join(preludePath, "prelude.bzl"));
    return true;
  } catch {
    return false;
  }
}

async function workspaceFlakePath(root: string): Promise<string> {
  const hidden = path.join(root, ".viberoots", "workspace", "flake.nix");
  try {
    await fsp.access(hidden);
    return hidden;
  } catch {}
  return path.join(root, "flake.nix");
}

async function resolvePreludePath(
  tmp: string,
  $: any,
  opts?: TempRepoBuckConfigOptions,
): Promise<string> {
  const sharedPrelude = String(process.env.VBR_SHARED_PRELUDE_PATH || "").trim();
  if (await hasPreludeEntrypoint(sharedPrelude)) return sharedPrelude;

  const localPreludeCandidates = [
    path.join(tmp, "prelude"),
    path.join(tmp, ".viberoots", "current", "prelude"),
    path.join(tmp, "viberoots", "prelude"),
  ];
  for (const localPrelude of localPreludeCandidates) {
    if (await hasPreludeEntrypoint(localPrelude)) return localPrelude;
  }

  // Fast path: seeded temp repos intentionally stay small and may omit prelude.
  // Reuse the already-materialized workspace prelude when available.
  const repoPrelude = path.join(process.cwd(), "prelude");
  if (!opts?.viberootsInputRoot && (await hasPreludeEntrypoint(repoPrelude))) return repoPrelude;

  if (cachedPreludePath) {
    const cached = await cachedPreludePath;
    if (await hasPreludeEntrypoint(cached)) return cached;
    else {
      cachedPreludePath = null;
    }
  }

  if (!cachedPreludePath) {
    cachedPreludePath = (async () => {
      const flakePath = await workspaceFlakePath(tmp);
      const flakeRoot = path.dirname(flakePath);
      const ambientInputRoot = String(process.env.VIBEROOTS_FLAKE_INPUT_ROOT || "").trim();
      const viberootsInputRoot = String(
        opts?.viberootsInputRoot ||
          (ambientInputRoot.startsWith("/nix/store/") ? ambientInputRoot : ""),
      ).trim();
      const hasViberootsInputRoot =
        viberootsInputRoot &&
        (await fsp
          .access(path.join(viberootsInputRoot, "flake.nix"))
          .then(() => true)
          .catch(() => false));
      if (hasViberootsInputRoot) {
        const pre = await $({
          cwd: tmp,
          stdio: "pipe",
        })`nix build --impure ${`path:${viberootsInputRoot}#buck2-prelude`} --no-link --no-write-lock-file --accept-flake-config --print-out-paths`;
        const out = String(pre.stdout || "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .pop();
        const preludePath = out ? path.join(out, "prelude").replaceAll("\\", "/") : "";
        if (await hasPreludeEntrypoint(preludePath)) return preludePath;
        throw new Error(
          `selected viberoots input did not produce a valid Buck prelude: ${viberootsInputRoot}`,
        );
      }
      try {
        const pre = await $({
          cwd: tmp,
          stdio: "pipe",
        })`nix build --impure ${`path:${flakeRoot}#buck2-prelude`} --no-link --no-write-lock-file --accept-flake-config --print-out-paths`;
        const out = String(pre.stdout || "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .pop();
        const preludePath = out ? path.join(out, "prelude").replaceAll("\\", "/") : "";
        if (await hasPreludeEntrypoint(preludePath)) return preludePath;
      } catch {}
      try {
        const ev = await $({
          cwd: tmp,
          stdio: "pipe",
        })`nix eval --impure --raw ${`path:${flakeRoot}#inputs.buck2.outPath`} --no-write-lock-file`;
        const p = String(ev.stdout || "").trim();
        const preludePath = p ? path.join(p, "prelude").replaceAll("\\", "/") : "";
        if (await hasPreludeEntrypoint(preludePath)) return preludePath;
      } catch {}
      return "";
    })();
  }
  return await cachedPreludePath;
}

export async function ensureBuckConfigForTempRepo(
  tmp: string,
  $: any,
  opts?: TempRepoBuckConfigOptions,
): Promise<void> {
  const preludePath = await resolvePreludePath(tmp, $, opts);

  const setupScript = [
    "set -euo pipefail",
    "printf '.\\n' > .buckroot",
    "mkdir -p viberoots",
    preludePath
      ? "[ -L viberoots/prelude ] && [ ! -e viberoots/prelude ] && rm -f viberoots/prelude"
      : ":",
    preludePath
      ? `[ -e viberoots/prelude ] || [ -L viberoots/prelude ] || ln -s "${preludePath}" viberoots/prelude`
      : ":",
    '[ -e viberoots/build-tools ] || [ -L viberoots/build-tools ] || { if [ -n "${VIBEROOTS_ROOT:-}" ] && [ -e "$VIBEROOTS_ROOT/build-tools" ]; then ln -s "$VIBEROOTS_ROOT/build-tools" viberoots/build-tools; fi; }',
    "printf '[buildfile]\\nname = TARGETS\\n\\n[repositories]\\nroot = ..\\nviberoots = .\\nprelude = ./prelude\\ntoolchains = ./toolchains\\nrepo_toolchains = ./toolchains\\nconfig = ./config\\nfbsource = ./config/fbsource_stub\\nfbcode = ./config/fbcode_stub\\n\\n[cells]\\nroot = ..\\nviberoots = .\\nprelude = ./prelude\\ntoolchains = ./toolchains\\nrepo_toolchains = ./toolchains\\nconfig = ./config\\nfbsource = ./config/fbsource_stub\\nfbcode = ./config/fbcode_stub\\n\\n[build]\\nprelude = prelude\\n' > viberoots/.buckconfig",
    "cat > .buckconfig <<'EOF'",
    "[buildfile]",
    "name = TARGETS",
    "",
    "[repositories]",
    "root = .",
    "viberoots = ./.viberoots/current",
    "prelude = ./.viberoots/workspace/prelude",
    "toolchains = ./.viberoots/current/toolchains",
    "repo_toolchains = ./.viberoots/workspace/toolchains",
    "config = ./config",
    "fbsource = ./.viberoots/current/config/fbsource_stub",
    "fbcode = ./.viberoots/current/config/fbcode_stub",
    "workspace_providers = ./.viberoots/workspace/providers",
    "workspace_buck = ./.viberoots/workspace/buck",
    "",
    "[cells]",
    "root = .",
    "viberoots = ./.viberoots/current",
    "prelude = ./.viberoots/workspace/prelude",
    "toolchains = ./.viberoots/current/toolchains",
    "repo_toolchains = ./.viberoots/workspace/toolchains",
    "config = ./config",
    "fbsource = ./.viberoots/current/config/fbsource_stub",
    "fbcode = ./.viberoots/current/config/fbcode_stub",
    "workspace_providers = ./.viberoots/workspace/providers",
    "workspace_buck = ./.viberoots/workspace/buck",
    "",
    "[build]",
    "prelude = prelude",
    "default_platform = //:no_cgo",
    "user_platform = //:no_cgo",
    "target_platforms = //:no_cgo",
    "action_env = SDKROOT,CPATH,LIBRARY_PATH,CGO_CFLAGS,CGO_CPPFLAGS,CGO_ENABLED,WORKSPACE_ROOT,BUCK_TEST_SRC,BUCK_GRAPH_JSON,BUCK_ISOLATION_DIR,BUCK_NESTED_ISO,REPO_ROOT,VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT,VIBEROOTS_ROOT,VIBEROOTS_SOURCE_ROOT,VIBEROOTS_FLAKE_INPUT_ROOT,ZX_INIT",
    "",
    "[project]",
    BUCK_PROJECT_IGNORE_LINE,
    "EOF",
    "mkdir -p .viberoots",
    "[ -L .viberoots/current ] && [ ! -e .viberoots/current/prelude/prelude.bzl ] && [ -e viberoots/prelude/prelude.bzl ] && rm -f .viberoots/current || true",
    '[ -n "${VIBEROOTS_ROOT:-}" ] && [ -e "$VIBEROOTS_ROOT/build-tools/tools/dev/zx-init.mjs" ] && [ ! -e .viberoots/current/build-tools/tools/dev/zx-init.mjs ] && rm -rf .viberoots/current || true',
    '[ -e .viberoots/current ] || { if [ -e viberoots/prelude/prelude.bzl ] && [ -e viberoots/build-tools ]; then ln -s ../viberoots .viberoots/current; elif [ -n "${VIBEROOTS_ROOT:-}" ] && [ -e "$VIBEROOTS_ROOT/build-tools" ]; then ln -s "$VIBEROOTS_ROOT" .viberoots/current; elif [ -e build-tools ]; then ln -s .. .viberoots/current; else ln -s ../viberoots .viberoots/current; fi; }',
    '[ -e viberoots/build-tools ] || [ -L viberoots/build-tools ] || { if [ -n "${VIBEROOTS_ROOT:-}" ] && [ -e "$VIBEROOTS_ROOT/build-tools" ]; then ln -s "$VIBEROOTS_ROOT/build-tools" viberoots/build-tools; elif [ -e .viberoots/current/build-tools ]; then ln -s ../.viberoots/current/build-tools viberoots/build-tools; fi; }',
    "mkdir -p .viberoots/workspace",
    preludePath
      ? "[ -L .viberoots/workspace/prelude ] && [ ! -e .viberoots/workspace/prelude/prelude.bzl ] && rm -f .viberoots/workspace/prelude"
      : ":",
    preludePath
      ? `[ -e .viberoots/workspace/prelude/prelude.bzl ] || [ -L .viberoots/workspace/prelude ] || ln -s "${preludePath}" .viberoots/workspace/prelude`
      : ":",
    'if [ ! -f .viberoots/workspace/flake.nix ]; then if [ -f flake.nix ]; then cp flake.nix .viberoots/workspace/flake.nix; elif [ -n "${VIBEROOTS_ROOT:-}" ] && [ -f "$VIBEROOTS_ROOT/.viberoots/workspace/flake.nix" ]; then cp "$VIBEROOTS_ROOT/.viberoots/workspace/flake.nix" .viberoots/workspace/flake.nix; else printf \'{ outputs = { self }: { }; }\\n\' > .viberoots/workspace/flake.nix; fi; fi',
    'if [ ! -f .viberoots/workspace/flake.lock ]; then if [ -f flake.lock ]; then cp flake.lock .viberoots/workspace/flake.lock; elif [ -n "${VIBEROOTS_ROOT:-}" ] && [ -f "$VIBEROOTS_ROOT/.viberoots/workspace/flake.lock" ]; then cp "$VIBEROOTS_ROOT/.viberoots/workspace/flake.lock" .viberoots/workspace/flake.lock; elif [ -n "${VIBEROOTS_ROOT:-}" ] && [ -f "$(dirname "$VIBEROOTS_ROOT")/.viberoots/workspace/flake.lock" ]; then cp "$(dirname "$VIBEROOTS_ROOT")/.viberoots/workspace/flake.lock" .viberoots/workspace/flake.lock; elif [ -n "${VIBEROOTS_ROOT:-}" ] && [ -f "$VIBEROOTS_ROOT/flake.lock" ]; then cp "$VIBEROOTS_ROOT/flake.lock" .viberoots/workspace/flake.lock; else printf \'{"nodes":{},"root":"root","version":7}\\n\' > .viberoots/workspace/flake.lock; fi; fi',
    "test -f .viberoots/workspace/nixpkgs-source-registry-extension.nix || printf '{ inputs }: { profiles = { }; }\\n' > .viberoots/workspace/nixpkgs-source-registry-extension.nix",
    "mkdir -p projects/config",
    "test -f projects/config/node-modules.hashes.json || printf '{}\\n' > projects/config/node-modules.hashes.json",
    "rm -f .viberoots/workspace/node-modules.hashes.json",
    'for base in config viberoots/config; do for cell in fbsource_stub fbcode_stub; do mkdir -p "$base/$cell"; printf "[buildfile]\\nname = TARGETS\\n" > "$base/$cell/.buckconfig"; printf "# stub %s cell for temp repositories\\n" "$cell" > "$base/$cell/TARGETS"; done; done',
    "mkdir -p config/go/constraints viberoots/config/go/constraints config/cpu viberoots/config/cpu config/os viberoots/config/os config/os/constraints viberoots/config/os/constraints",
    'for base in config viberoots/config; do printf "[buildfile]\\nname = TARGETS\\n" > "$base/.buckconfig"; printf "# temp repository config prelude placeholder\\n" > "$base/prelude.bzl"; printf "# temp repository config rules placeholder\\n" > "$base/rules.bzl"; done',
    'for base in config viberoots/config; do printf "[buildfile]\\nname = TARGETS\\n" > "$base/go/constraints/.buckconfig"; cat > "$base/go/constraints/TARGETS" <<\'EOF\'\nconstraint_setting(name = "cgo_enabled", visibility = ["PUBLIC"])\nconstraint_value(name = "cgo_enabled_false", constraint_setting = ":cgo_enabled", visibility = ["PUBLIC"])\nconstraint_setting(name = "asan", visibility = ["PUBLIC"])\nconstraint_value(name = "asan_false", constraint_setting = ":asan", visibility = ["PUBLIC"])\nconstraint_setting(name = "race", visibility = ["PUBLIC"])\nconstraint_value(name = "race_false", constraint_setting = ":race", visibility = ["PUBLIC"])\nEOF\ndone',
    'for base in config viberoots/config; do printf "[buildfile]\\nname = TARGETS\\n" > "$base/cpu/.buckconfig"; cat > "$base/cpu/TARGETS" <<\'EOF\'\nconstraint_setting(name = "cpu", visibility = ["PUBLIC"])\nconstraint_value(name = "arm64", constraint_setting = ":cpu", visibility = ["PUBLIC"])\nconstraint_value(name = "x86_64", constraint_setting = ":cpu", visibility = ["PUBLIC"])\nEOF\ndone',
    'for base in config viberoots/config; do printf "[buildfile]\\nname = TARGETS\\n" > "$base/os/.buckconfig"; cat > "$base/os/TARGETS" <<\'EOF\'\nconstraint_setting(name = "os", visibility = ["PUBLIC"])\nconstraint_value(name = "macos", constraint_setting = ":os", visibility = ["PUBLIC"])\nconstraint_value(name = "linux", constraint_setting = ":os", visibility = ["PUBLIC"])\nconstraint_value(name = "windows", constraint_setting = ":os", visibility = ["PUBLIC"])\nEOF\ndone',
    'for base in config viberoots/config; do printf "[buildfile]\\nname = TARGETS\\n" > "$base/os/constraints/.buckconfig"; cat > "$base/os/constraints/TARGETS" <<\'EOF\'\nconstraint_setting(name = "os", visibility = ["PUBLIC"])\nconstraint_value(name = "android", constraint_setting = ":os", visibility = ["PUBLIC"])\nconstraint_value(name = "linux", constraint_setting = ":os", visibility = ["PUBLIC"])\nconstraint_value(name = "macos", constraint_setting = ":os", visibility = ["PUBLIC"])\nconstraint_value(name = "windows", constraint_setting = ":os", visibility = ["PUBLIC"])\nEOF\ndone',
    "[ -L .viberoots/workspace/buck ] && [ ! -e .viberoots/workspace/buck ] && rm -f .viberoots/workspace/buck",
    "[ -L .viberoots/workspace/providers ] && [ ! -e .viberoots/workspace/providers ] && rm -f .viberoots/workspace/providers",
    "mkdir -p .viberoots/workspace/buck",
    "printf '[buildfile]\\nname = TARGETS\\n' > .viberoots/workspace/buck/.buckconfig",
    "printf '[]\\n' > .viberoots/workspace/buck/graph.json",
    'printf "# Workspace root is derived from this declared input\'s sandbox path.\\n" > .viberoots/workspace/buck/workspace-root.env',
    "cat > .viberoots/workspace/buck/TARGETS <<'EOF'",
    'load("@prelude//:rules.bzl", "export_file")',
    'export_file(name = "graph.json", src = "graph.json", out = "graph.37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570.json", visibility = ["PUBLIC"])',
    'export_file(name = "workspace-root.env", src = "workspace-root.env", visibility = ["PUBLIC"])',
    "EOF",
    "mkdir -p .viberoots/workspace/providers",
    "printf '[buildfile]\\nname = TARGETS\\n' > .viberoots/workspace/providers/.buckconfig",
    "cat > .viberoots/workspace/providers/auto_map.bzl <<'EOF'",
    "MODULE_PROVIDERS = {}",
    "EOF",
    "cat > .viberoots/workspace/providers/TARGETS <<'EOF'",
    "# generated workspace provider package placeholder",
    "EOF",
    "mkdir -p toolchains",
    "[ -e viberoots/toolchains ] || [ -L viberoots/toolchains ] || ln -s ../toolchains viberoots/toolchains",
    "printf '[buildfile]\\nname = TARGETS\\n' > toolchains/.buckconfig",
    "cat > toolchains/remote_profile_conversion_fixture.bzl <<'EOF'",
    'load("@prelude//:build_mode.bzl", "BuildModeInfo")',
    "",
    "def _remote_profile_conversion_action_key_impl(_ctx):",
    "    return [",
    "        DefaultInfo(),",
    '        BuildModeInfo(cell = "viberoots", mode = "remote-profile-probe"),',
    "    ]",
    "",
    "remote_profile_conversion_action_key = rule(",
    "    impl = _remote_profile_conversion_action_key_impl,",
    "    attrs = {},",
    ")",
    "EOF",
    "cat > toolchains/TARGETS <<'EOF'",
    'load("@repo_toolchains//:go.bzl", "system_go_bootstrap_toolchain", "system_go_toolchain")',
    'load("@repo_toolchains//:python.bzl", "system_python_bootstrap_toolchain", "system_python_toolchain")',
    'load("@prelude//tests:test_toolchain.bzl", "noop_test_toolchain")',
    'load("@repo_toolchains//:remote_test_execution.bzl", "remote_test_execution_toolchain")',
    'load("@prelude//toolchains:genrule.bzl", "system_genrule_toolchain")',
    'load("@repo_toolchains//:cxx.bzl", "system_cxx_toolchain")',
    'load("@repo_toolchains//:remote_profile_conversion_fixture.bzl", "remote_profile_conversion_action_key")',
    "",
    'system_go_toolchain(name = "go", visibility = ["PUBLIC"]) ',
    'system_go_bootstrap_toolchain(name = "go_bootstrap", visibility = ["PUBLIC"]) ',
    'system_python_bootstrap_toolchain(name = "python_bootstrap", visibility = ["PUBLIC"]) ',
    'system_python_toolchain(name = "python", visibility = ["PUBLIC"]) ',
    'system_cxx_toolchain(name = "cxx", visibility = ["PUBLIC"]) ',
    'noop_test_toolchain(name = "test", visibility = ["PUBLIC"]) ',
    "remote_test_execution_toolchain(",
    '    name = "remote_test_execution",',
    "    default_profile = None,",
    "    default_run_as_bundle = False,",
    "    profiles = {",
    '        "linux-x86_64-default": {',
    '            "capabilities": {',
    '                "arch": "x86_64",',
    '                "os": "linux",',
    '                "resource_class": "default",',
    '                "viberoots_remote_profile": "linux-x86_64-default",',
    "            },",
    '            "dependencies": [],',
    '            "listing_capabilities": {',
    '                "arch": "x86_64",',
    '                "os": "linux",',
    '                "resource_class": "default",',
    '                "viberoots_remote_profile": "linux-x86_64-default",',
    "            },",
    '            "local_enabled": False,',
    '            "local_listing_enabled": False,',
    '            "remote_cache_enabled": True,',
    '            "resource_units": 1,',
    '            "use_case": "buck2-test",',
    "        },",
    "    },",
    '    visibility = ["PUBLIC"],',
    ") ",
    'remote_profile_conversion_action_key(name = "remote_profile_conversion_action_key", visibility = ["PUBLIC"]) ',
    'system_genrule_toolchain(name = "genrule", visibility = ["PUBLIC"]) ',
    "EOF",
    "cat > TARGETS <<'EOF'",
    "platform(",
    '    name = "no_cgo",',
    "    constraint_values = [",
    '        "config//go/constraints:cgo_enabled_false",',
    '        "config//go/constraints:asan_false",',
    '        "config//go/constraints:race_false",',
    "    ],",
    '    visibility = ["PUBLIC"],',
    ")",
    "EOF",
    "cat > .gitignore <<'EOF'",
    "# Temp repo hygiene: keep tool/shell noise out of git snapshots.",
    ".DS_Store",
    "/.nix-zsh/",
    "/.vscode/",
    "/.zsh_history",
    "/.zcompdump*",
    "/.full-test-output.log",
    "/.patch-sessions.json",
    "/.ready",
    "/*.log",
    "/devbuild.*.log",
    "/proc.*.log",
    "/node.sample.*.log",
    "/test-tmp-paths.log",
    "/.buck/",
    "/.cache/",
    "/buck-out/",
    "/node_modules/",
    "EOF",
  ].join("\n");
  await $({ cwd: tmp })`bash --noprofile --norc -c ${setupScript}`;
  await writeGlobalNixInputTargetFixtures(tmp);
}

export async function writeGlobalNixInputTargetFixtures(root: string): Promise<void> {
  const globalTargets = await readGlobalNixInputTargets(root);
  await Promise.all([
    fsp.mkdir(path.join(root, "projects/config"), { recursive: true }),
    fsp.mkdir(path.join(root, ".viberoots/workspace"), { recursive: true }),
  ]);
  await Promise.all([
    fsp.writeFile(path.join(root, "projects/config/TARGETS"), globalTargets.projectsConfigTargets),
    fsp.writeFile(path.join(root, ".viberoots/workspace/TARGETS"), globalTargets.workspaceTargets),
  ]);
}

export async function ensureWorkspaceRootEnvFile(
  tmp: string,
  activeViberootsRoot?: string,
): Promise<void> {
  try {
    const current = path.join(tmp, ".viberoots", "current");
    const currentZxInit = path.join(current, "build-tools", "tools", "dev", "zx-init.mjs");
    const buckToolsDir = path.join(tmp, WORKSPACE_BUCK_STATE_DIR);
    const viberootsRoot = activeViberootsRoot || process.env.VIBEROOTS_ROOT || "";
    await fsp.mkdir(path.join(tmp, ".viberoots"), { recursive: true });
    const currentOk = await fsp
      .access(currentZxInit)
      .then(() => true)
      .catch(() => false);
    if (!currentOk) {
      await fsp.rm(current, { recursive: true, force: true }).catch(() => {});
      if (viberootsRoot) {
        await fsp.symlink(viberootsRoot, current).catch(async () => {
          await fsp.symlink("../viberoots", current).catch(() => {});
        });
      } else {
        await fsp.symlink("../viberoots", current).catch(() => {});
      }
    }
    await fsp.mkdir(buckToolsDir, { recursive: true });
    await fsp.writeFile(
      path.join(buckToolsDir, "workspace-root.env"),
      "# Workspace root is derived from this declared input's sandbox path.\n",
      "utf8",
    );
    const graphPath = path.join(tmp, DEFAULT_GRAPH_PATH);
    try {
      await fsp.access(graphPath);
    } catch {
      await fsp.writeFile(graphPath, "[]\n", "utf8");
    }
  } catch {}
}
