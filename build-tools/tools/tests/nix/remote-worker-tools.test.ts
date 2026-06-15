#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

process.env.TEST_RSYNC_ROOTS =
  process.env.TEST_RSYNC_ROOTS ||
  "flake.nix flake.lock build-tools/tools/nix build-tools/tools/lib build-tools/tools/remote-exec";

async function build(root: string, $: any, attr: string): Promise<string> {
  const res = await $({
    cwd: root,
    stdio: "pipe",
  })`nix build .#${attr} --no-link --print-out-paths --accept-flake-config`;
  const out = String(res.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .pop();
  if (!out) throw new Error(`missing output path for ${attr}`);
  return out;
}

async function expectBin(root: string, bin: string): Promise<void> {
  await fs.access(path.join(root, "bin", bin));
}

async function execFileResult(
  file: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    execFile(file, args, opts, (error, stdout, stderr) => {
      const code =
        error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number"
          ? ((error as NodeJS.ErrnoException & { code: number }).code as number)
          : 0;
      resolve({ code, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

test("remote worker and CI tool closures expose declared tools only from Nix store", async () => {
  await runInTemp("remote-worker-tools", async (tmp, $) => {
    const worker = await build(tmp, $, "remote-worker-tools");
    const ci = await build(tmp, $, "remote-ci-tools");

    for (const bin of ["bash", "git", "node", "pnpm", "buck2", "zx-wrapper", "timeout"]) {
      await expectBin(worker, bin);
    }
    for (const bin of ["nix", "buck2", "node", "zx-wrapper", "attic", "cachix"]) {
      await expectBin(ci, bin);
    }

    assert.ok(worker.startsWith("/nix/store/"));
    assert.ok(ci.startsWith("/nix/store/"));
    const inventory = await fs.readFile(
      path.join(worker, "share", "viberoots", "remote-runtime-primitives.json"),
      "utf8",
    );
    assert.match(inventory, /minimal-nix-bootstrap/);
    assert.doesNotMatch(inventory, /PRIVATE KEY|token|secret/i);
  });
});

test("remote worker bootstrap uses closure PATH and avoids scheduler registration", async () => {
  await runInTemp("remote-worker-bootstrap", async (tmp, $) => {
    const bootstrap = await build(tmp, $, "remote-worker-bootstrap");
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`${path.join(bootstrap, "bin", "remote-worker-bootstrap")} --check-only`;

    const output = `${res.stdout}\n${res.stderr}`;
    assert.match(output, /remote-worker-tools=\/nix\/store\//);
    assert.match(output, /PATH=\/nix\/store\/[^:\n]+\/bin/);
    assert.doesNotMatch(output, /PATH=.*\/usr\/local/);
    assert.match(output, /local checks passed/);
    assert.match(output, /scheduler registration is disabled/);
  });
});

test("remote worker bootstrap app is a thin zx-wrapper launcher", async () => {
  const app = await fs.readFile("build-tools/tools/nix/flake/outputs-apps.nix", "utf8");
  const packages = await fs.readFile("build-tools/tools/nix/flake/packages/default.nix", "utf8");
  const launcher = await fs.readFile(
    "build-tools/tools/nix/flake/packages/remote-worker-bootstrap.nix",
    "utf8",
  );
  const helper = await fs.readFile(
    "build-tools/tools/remote-exec/remote-worker-bootstrap.ts",
    "utf8",
  );

  assert.match(helper, /^#!\/usr\/bin\/env zx-wrapper/);
  assert.match(app, /import \.\/packages\/remote-worker-bootstrap\.nix/);
  assert.match(packages, /import \.\/remote-worker-bootstrap\.nix/);
  assert.match(launcher, /exec \$\{remote-worker-tools\}\/bin\/zx-wrapper/);
  assert.match(launcher, /--remote-worker-tools "\$\{remote-worker-tools\}"/);
  assert.doesNotMatch(launcher, /zx-init\.mjs/);
  assert.doesNotMatch(launcher, /for bin in/);
  assert.doesNotMatch(launcher, /command -v/);
  assert.match(helper, /requiredWorkerBins/);
  assert.match(helper, /scheduler registration is disabled/);
});

test("remote worker bootstrap rejects non-store tools before PATH construction", async () => {
  await runInTemp("remote-worker-bootstrap-non-store", async (tmp) => {
    const res = await execFileResult(
      "zx-wrapper",
      [
        "build-tools/tools/remote-exec/remote-worker-bootstrap.ts",
        "--remote-worker-tools",
        path.join(tmp, "not-store"),
        "--check-only",
      ],
      { cwd: tmp, env: { ...process.env, PATH: process.env.PATH || "" } },
    );

    assert.equal(res.code, 1, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /must be a Nix store path/);
    assert.doesNotMatch(res.stdout, /^PATH=/m);
  });
});

test("remote CI helper smoke flow runs with PATH restricted to remote-ci-tools", async () => {
  await runInTemp("remote-ci-tools-path", async (tmp, $) => {
    const ci = await build(tmp, $, "remote-ci-tools");
    const bash = path.join(ci, "bin", "bash");
    const res = await execFileResult(
      bash,
      [
        "--noprofile",
        "--norc",
        "-c",
        `set -euo pipefail
for bin in bash nix buck2 node zx-wrapper; do
  if ! command -v "$bin" >/dev/null; then
    echo "missing $bin in PATH=$PATH" >&2
    ls -la "$PATH" >&2 || true
    exit 1
  fi
done
nix --version >/dev/null
node --version >/dev/null
if command -v aws >/dev/null 2>&1; then
  echo "ambient aws unexpectedly visible" >&2
  exit 1
fi
echo "remote-ci-tools restricted PATH passed"`,
      ],
      {
        cwd: tmp,
        env: {
          SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
          HOME: tmp,
          PATH: path.join(ci, "bin"),
          TMPDIR: tmp,
        },
      },
    );

    assert.equal(res.code, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(String(res.stdout), /restricted PATH passed/);
  });
});
