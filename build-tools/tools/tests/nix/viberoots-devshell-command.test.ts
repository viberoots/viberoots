#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("devshell wires viberoots as a Nix-provided PATH command", async () => {
  const devshell = await fsp.readFile("build-tools/tools/nix/devshell.nix", "utf8");
  assert.match(devshell, /viberootsCommand = import \.\/packages\/viberoots-command\.nix/);
  assert.match(devshell, /buildInputs = \[[^\]]*\bviberootsCommand\b/s);
  assert.match(devshell, /export PATH="\$vbr_nix_bin:\$repo_prefix/);
  assert.match(devshell, /export PATH="\$vbr_nix_bin:\$d\/build-tools\/tools\/bin/);

  const built = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`nix build --accept-flake-config .#viberoots --no-link --print-out-paths`;

  assert.equal(
    built.exitCode,
    0,
    `expected nix build .#viberoots to succeed\nstdout:\n${built.stdout}\nstderr:\n${built.stderr}`,
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
  assert.ok(["local", "remote"].includes(status.sourceMode));
});
