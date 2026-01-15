import * as fsp from "node:fs/promises";
import path from "node:path";
import "./worker-init";

export async function ensureBuckConfigForTempRepo(tmp: string, $: any): Promise<void> {
  let preludePath = "";
  const localPrelude = path.join(tmp, "prelude");
  try {
    await fsp.access(localPrelude);
    preludePath = localPrelude;
  } catch {}
  if (!preludePath) {
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
      if (out) preludePath = path.join(out, "prelude").replaceAll("\\", "/");
    } catch {}
    if (!preludePath) {
      try {
        const ev = await $({
          cwd: tmp,
          stdio: "pipe",
        })`nix eval --raw ${`path:${tmp}#inputs.buck2.outPath`}`;
        const p = String(ev.stdout || "").trim();
        if (p) preludePath = path.join(p, "prelude").replaceAll("\\", "/");
      } catch {}
    }
  }
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
    "",
    "[cells]",
    "root = .",
    "prelude = ./prelude",
    "toolchains = ./toolchains",
    "repo_toolchains = ./toolchains",
    "config = ./prelude",
    "fbsource = ./prelude/third-party/fbsource_stub",
    "fbcode = ./prelude/third-party/fbcode_stub",
    "",
    "[build]",
    "prelude = prelude",
    "default_platform = //:no_cgo",
    "user_platform = //:no_cgo",
    "target_platforms = //:no_cgo",
    "action_env = SDKROOT,CPATH,LIBRARY_PATH,CGO_CFLAGS,CGO_CPPFLAGS,CGO_ENABLED,WORKSPACE_ROOT,REPO_ROOT",
    "EOF",
    "mkdir -p toolchains",
    "printf '[buildfile]\\nname = TARGETS\\n' > toolchains/.buckconfig",
    "cat > toolchains/TARGETS <<'EOF'",
    'load("@repo_toolchains//:go.bzl", "system_go_bootstrap_toolchain", "system_go_toolchain")',
    'load("@repo_toolchains//:python.bzl", "system_python_bootstrap_toolchain", "system_python_toolchain")',
    'load("@prelude//tests:test_toolchain.bzl", "noop_test_toolchain")',
    'load("@repo_toolchains//:remote_test_execution.bzl", "remote_test_execution_toolchain")',
    'load("@prelude//toolchains:genrule.bzl", "system_genrule_toolchain")',
    'load("@repo_toolchains//:cxx.bzl", "system_cxx_toolchain")',
    "",
    'system_go_toolchain(name = "go", visibility = ["PUBLIC"]) ',
    'system_go_bootstrap_toolchain(name = "go_bootstrap", visibility = ["PUBLIC"]) ',
    'system_python_bootstrap_toolchain(name = "python_bootstrap", visibility = ["PUBLIC"]) ',
    'system_python_toolchain(name = "python", visibility = ["PUBLIC"]) ',
    'system_cxx_toolchain(name = "cxx", visibility = ["PUBLIC"]) ',
    'noop_test_toolchain(name = "test", visibility = ["PUBLIC"]) ',
    'remote_test_execution_toolchain(name = "remote_test_execution", visibility = ["PUBLIC"]) ',
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
    await fsp.mkdir(path.join(tmp, "tools", "buck"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "tools", "buck", "workspace-root.env"),
      `WORKSPACE_ROOT=${tmp}\n`,
      "utf8",
    );
  } catch {}
}
