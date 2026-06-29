#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("devshell wires viberoots as a Nix-provided PATH command", async () => {
  const devshell = await fsp.readFile("viberoots/build-tools/tools/nix/devshell.nix", "utf8");
  assert.match(devshell, /viberootsCommand = import \.\/packages\/viberoots-command\.nix/);
  assert.match(devshell, /entry_cwd="\$PWD"/);
  assert.match(devshell, /dev_root="''\$\{WORKSPACE_ROOT:-\$PWD\}"/);
  assert.match(devshell, /dev_root="\$\(cd "\$WORKSPACE_ROOT" && pwd\)"/);
  assert.match(devshell, /local d="''\$\{WORKSPACE_ROOT:-\$PWD\}"/);
  assert.match(devshell, /\( -n "''\$\{WORKSPACE_ROOT:-\}" \|\| -f "\$d\/flake\.nix" \)/);
  assert.match(devshell, /cd "\$entry_cwd"/);
  assert.match(devshell, /buildInputs = \[[^\]]*\bviberootsCommand\b/s);
  assert.match(devshell, /local vbr_host_nix_bin=""/);
  assert.match(devshell, /\[ -n "''\$\{VBR_NIX_BIN:-\}" \] && \[ -x "\$VBR_NIX_BIN" \]/);
  assert.match(devshell, /\/nix\/var\/nix\/profiles\/default\/bin\/nix/);
  assert.match(devshell, /export VBR_NIX_BIN="\/nix\/var\/nix\/profiles\/default\/bin\/nix"/);
  assert.match(devshell, /export PATH="\$repo_prefix:/);
  assert.match(devshell, /local vbr_tools_bin="\$PWD\/build-tools\/tools\/bin"/);
  assert.match(devshell, /vbr_tools_bin="\$PWD\/viberoots\/build-tools\/tools\/bin"/);
  assert.match(devshell, /local repo_prefix="\$vbr_tools_bin:\$PWD\/\.direnv\/bin:\$vbr_node_bin"/);
  assert.match(devshell, /vbr_source="\$\{viberootsRoot\}"/);
  assert.match(devshell, /vbr_source="\$PWD\/viberoots"/);
  assert.match(devshell, /vbr_source="\$PWD"/);
  assert.match(devshell, /export VIBEROOTS_ROOT="\$vbr_source"/);
  assert.match(devshell, /viberoots init-workspace --shell-entry --source "\$vbr_source"/);
  assert.match(devshell, /eval "\$\(vbr completion zsh\)"/);
  assert.match(devshell, /eval "\$\(vbr completion bash\)"/);
  assert.doesNotMatch(devshell, /eval "\$\(viberoots completion/);

  const built = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`nix build --accept-flake-config path:${path.resolve("viberoots")}#viberoots --no-link --print-out-paths`;

  assert.equal(
    built.exitCode,
    0,
    `expected nix build ./viberoots#viberoots to succeed\nstdout:\n${built.stdout}\nstderr:\n${built.stderr}`,
  );
  const outPath =
    String(built.stdout || "")
      .trim()
      .split(/\r?\n/)
      .at(-1) || "";
  assert.match(outPath, /^\/nix\/store\/.+-viberoots$/);

  const script = `
set -euo pipefail
cmd="$(command -v viberoots)"
printf 'cmd=%s\\n' "$cmd"
test "$cmd" = "${path.join(outPath, "bin", "viberoots")}"
viberoots version --json
`;
  const run = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
    env: {
      ...process.env,
      PATH: `${path.join(outPath, "bin")}:/usr/bin:/bin`,
    },
  })`bash --noprofile --norc -c ${script}`;

  assert.equal(
    run.exitCode,
    0,
    `expected Nix-provided viberoots on PATH to run\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
  );
  const stdout = String(run.stdout || "");
  assert.match(stdout, /^cmd=\/nix\/store\/.*\/bin\/viberoots$/m);

  const jsonStart = stdout.indexOf("{");
  assert.ok(jsonStart >= 0, "expected viberoots version --json output");
  const status = JSON.parse(stdout.slice(jsonStart));
  assert.equal(status.workspaceRoot, process.cwd());
  assert.equal(status.declaredVersion, "0.0.0-dev");
  assert.equal(status.releaseTag, "v0.0.0-dev");
  assert.ok(["local", "remote"].includes(status.sourceMode));
});
