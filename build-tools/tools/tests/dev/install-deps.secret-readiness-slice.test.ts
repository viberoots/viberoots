#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ensureInstallSecretReadiness,
  isInstallSecretReadinessApplicable,
} from "../../dev/install/secret-readiness";

const baseFlags = {
  withoutSecrets: false,
  yes: false,
  machineLabel: "",
  rotateBootstrapCredentials: false,
  rotateDeploymentCredentials: false,
  forceOverwriteLocalCredentials: false,
};

test("install secret readiness is quiet when Pleomino metadata is absent", async () => {
  await withRepo(async (repoRoot) => {
    let probeCalls = 0;
    const output = await captureOutput(async () => {
      await ensureInstallSecretReadiness({
        repoRoot,
        dryRun: false,
        verbose: false,
        flags: baseFlags,
        deps: {
          probe: async () => {
            probeCalls += 1;
            throw new Error("probe must not run");
          },
          bootstrap: async () => {
            throw new Error("bootstrap must not run");
          },
        },
      });
    });
    assert.equal(await isInstallSecretReadinessApplicable(repoRoot), false);
    assert.equal(probeCalls, 0);
    assert.equal(output, "");
  });
});

test("install secret readiness reports not applicable in verbose partial checkouts", async () => {
  await withRepo(async (repoRoot) => {
    const output = await captureOutput(async () => {
      await ensureInstallSecretReadiness({
        repoRoot,
        dryRun: false,
        verbose: true,
        flags: baseFlags,
        deps: {
          probe: async () => {
            throw new Error("probe must not run");
          },
        },
      });
    });
    assert.match(output, /not applicable in this checkout/);
  });
});

test("install secret readiness treats metadata access failures as real errors", async () => {
  await withRepo(async (repoRoot) => {
    const shared = path.join(repoRoot, "projects/deployments/pleomino/shared");
    await fsp.mkdir(shared, { recursive: true });
    await fsp.writeFile(path.join(shared, "family.bzl"), "");
    await fsp.chmod(shared, 0o000);
    try {
      await assert.rejects(
        ensureInstallSecretReadiness({
          repoRoot,
          dryRun: false,
          verbose: false,
          flags: baseFlags,
        }),
        { code: "EACCES" },
      );
    } finally {
      await fsp.chmod(shared, 0o700);
    }
  });
});

test("install secret readiness explicit skip flags run before probes", async () => {
  await withRepo(async (repoRoot) => {
    for (const opts of [
      { dryRun: true, flags: baseFlags },
      { dryRun: false, flags: { ...baseFlags, withoutSecrets: true } },
    ]) {
      await ensureInstallSecretReadiness({
        repoRoot,
        verbose: false,
        ...opts,
        deps: {
          probe: async () => {
            throw new Error("probe must not run");
          },
        },
      });
    }
  });
});

test("install deps glue-only exits before secret readiness", async () => {
  const source = await fsp.readFile("build-tools/tools/dev/install/deps-main.ts", "utf8");
  const glueOnlyStart = source.indexOf("if (glueOnly) {");
  const glueOnlyExit = source.indexOf("process.exit(0);", glueOnlyStart);
  const readinessCall = source.indexOf("await ensureInstallSecretReadiness({");
  assert.ok(glueOnlyStart >= 0, "deps-main.ts must keep an explicit glue-only branch");
  assert.ok(glueOnlyExit > glueOnlyStart, "glue-only branch must exit before normal install flow");
  assert.ok(
    readinessCall > glueOnlyExit,
    "deps-main.ts --glue-only must skip before secret readiness imports/probes can run",
  );
});

async function captureOutput(fn: () => Promise<void>) {
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;
  let output = "";
  const capture = ((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = capture;
  process.stderr.write = capture as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
  return output;
}

async function withRepo(fn: (repoRoot: string) => Promise<void>) {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "install-secret-slice-"));
  try {
    await fn(repoRoot);
  } finally {
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
}
