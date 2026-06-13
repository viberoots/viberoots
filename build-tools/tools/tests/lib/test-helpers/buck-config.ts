import * as fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GRAPH_PATH, WORKSPACE_BUCK_STATE_DIR } from "../../../lib/workspace-state-paths";
import "./worker-init";

let cachedPreludePath: Promise<string> | null = null;

async function resolvePreludePath(tmp: string, $: any): Promise<string> {
  const sharedPrelude = String(process.env.VBR_SHARED_PRELUDE_PATH || "").trim();
  if (sharedPrelude) {
    try {
      await fsp.access(sharedPrelude);
      return sharedPrelude;
    } catch {}
  }

  const localPrelude = path.join(tmp, "prelude");
  try {
    await fsp.access(localPrelude);
    return localPrelude;
  } catch {}

  // Fast path: seeded temp repos intentionally stay small and may omit prelude.
  // Reuse the already-materialized workspace prelude when available.
  const repoPrelude = path.join(process.cwd(), "prelude");
  try {
    await fsp.access(repoPrelude);
    return repoPrelude;
  } catch {}

  if (!cachedPreludePath) {
    cachedPreludePath = (async () => {
      try {
        const pre = await $({
          cwd: tmp,
          stdio: "pipe",
        })`nix build ${`path:${tmp}#buck2-prelude`} --no-link --accept-flake-config --print-out-paths`;
        const out = String(pre.stdout || "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .pop();
        if (out) return path.join(out, "prelude").replaceAll("\\", "/");
      } catch {}
      try {
        const ev = await $({
          cwd: tmp,
          stdio: "pipe",
        })`nix eval --raw ${`path:${tmp}#inputs.buck2.outPath`}`;
        const p = String(ev.stdout || "").trim();
        if (p) return path.join(p, "prelude").replaceAll("\\", "/");
      } catch {}
      return "";
    })();
  }

  return await cachedPreludePath;
}

export async function ensureBuckConfigForTempRepo(tmp: string, $: any): Promise<void> {
  const preludePath = await resolvePreludePath(tmp, $);
  if (!preludePath) return;

  const setupScript = [
    "set -euo pipefail",
    "printf '.\\n' > .buckroot",
    `[ -e prelude ] || ln -s "${preludePath}" prelude`,
    "cat > .buckconfig <<'EOF'",
    "[buildfile]",
    "name = TARGETS",
    "",
    "[repositories]",
    "root = .",
    "prelude = ./prelude",
    "toolchains = ./toolchains",
    "repo_toolchains = ./toolchains",
    "config = ./prelude",
    "fbsource = ./prelude/third-party/fbsource_stub",
    "fbcode = ./prelude/third-party/fbcode_stub",
    "workspace_providers = ./.viberoots/workspace/providers",
    "workspace_buck = ./.viberoots/workspace/buck",
    "",
    "[cells]",
    "root = .",
    "prelude = ./prelude",
    "toolchains = ./toolchains",
    "repo_toolchains = ./toolchains",
    "config = ./prelude",
    "fbsource = ./prelude/third-party/fbsource_stub",
    "fbcode = ./prelude/third-party/fbcode_stub",
    "workspace_providers = ./.viberoots/workspace/providers",
    "workspace_buck = ./.viberoots/workspace/buck",
    "",
    "[build]",
    "prelude = prelude",
    "default_platform = //:no_cgo",
    "user_platform = //:no_cgo",
    "target_platforms = //:no_cgo",
    "action_env = SDKROOT,CPATH,LIBRARY_PATH,CGO_CFLAGS,CGO_CPPFLAGS,CGO_ENABLED,WORKSPACE_ROOT,BUCK_TEST_SRC,BUCK_GRAPH_JSON,BUCK_ISOLATION_DIR,BUCK_NESTED_ISO,REPO_ROOT",
    "EOF",
    "mkdir -p .viberoots/workspace/buck",
    "printf '[buildfile]\\nname = TARGETS\\n' > .viberoots/workspace/buck/.buckconfig",
    "printf '[]\\n' > .viberoots/workspace/buck/graph.json",
    "printf 'WORKSPACE_ROOT=%s\\n' \"$PWD\" > .viberoots/workspace/buck/workspace-root.env",
    "cat > .viberoots/workspace/buck/TARGETS <<'EOF'",
    'load("@prelude//:rules.bzl", "export_file")',
    "",
    'export_file(name = "graph.json", src = "graph.json", visibility = ["PUBLIC"])',
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
    'load("@prelude//:rules.bzl", "export_file")',
    "",
    "platform(",
    '    name = "no_cgo",',
    "    constraint_values = [",
    '        "config//go/constraints:cgo_enabled_false",',
    '        "config//go/constraints:asan_false",',
    '        "config//go/constraints:race_false",',
    "    ],",
    '    visibility = ["PUBLIC"],',
    ")",
    "",
    "export_file(",
    '    name = "flake.lock",',
    '    src = "flake.lock",',
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

  try {
    await $({
      cwd: tmp,
    })`bash -c 'echo ==== .buckconfig ====; sed -n 1,200p .buckconfig || true; echo ==== toolchains/TARGETS ====; sed -n 1,200p toolchains/TARGETS || true'`;
  } catch {}
}

export async function ensureWorkspaceRootEnvFile(tmp: string): Promise<void> {
  try {
    const buckToolsDir = path.join(tmp, WORKSPACE_BUCK_STATE_DIR);
    await fsp.mkdir(buckToolsDir, { recursive: true });
    await fsp.writeFile(
      path.join(buckToolsDir, "workspace-root.env"),
      `WORKSPACE_ROOT=${tmp}\n`,
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
