import assert from "node:assert/strict";
import { test } from "node:test";
import {
  baseFlags,
  captureStderr,
  ensureReadiness,
  nonEmptyResetPlan,
  withRepo,
  writeCredentials,
  writeResolver,
} from "./install-deps.secret-readiness.fixture";

test("install secret readiness handles opt-out, declined prompt, and non-interactive missing setup", async () => {
  await withRepo(async (repoRoot) => {
    const calls: string[][] = [];
    await ensureReadiness(repoRoot, {
      flags: { ...baseFlags, withoutSecrets: true },
      deps: { bootstrap: async (args) => void calls.push(args), isInteractive: () => false },
    });
    assert.deepEqual(calls, []);
    await assert.rejects(
      ensureReadiness(repoRoot, {
        flags: baseFlags,
        deps: { bootstrap: async (args) => void calls.push(args), isInteractive: () => false },
      }),
      /i --yes/,
    );
    await writeResolver(repoRoot);
    const stderr = await captureStderr(async () => {
      await ensureReadiness(repoRoot, {
        flags: baseFlags,
        deps: {
          isInteractive: () => true,
          prompt: async () => false,
          bootstrap: async (args) => void calls.push(args),
        },
      });
    });
    assert.match(stderr, /Rerun `i` and accept the prompt/);
    assert.deepEqual(calls, []);
  });
});

test("install secret readiness --yes and env override allow non-interactive repo bootstrap", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    const calls: string[][] = [];
    await ensureReadiness(repoRoot, {
      flags: { ...baseFlags, yes: true },
      deps: { bootstrap: async (args) => void calls.push(args), isInteractive: () => false },
    });
    assert.deepEqual(calls, [["repo", "--yes", "--login-mode", "browser"]]);
    calls.length = 0;
    const old = process.env.INSTALL_DEPS_SETUP_SECRETS;
    process.env.INSTALL_DEPS_SETUP_SECRETS = "1";
    try {
      await ensureReadiness(repoRoot, {
        flags: baseFlags,
        deps: { bootstrap: async (args) => void calls.push(args), isInteractive: () => false },
      });
    } finally {
      if (old === undefined) delete process.env.INSTALL_DEPS_SETUP_SECRETS;
      else process.env.INSTALL_DEPS_SETUP_SECRETS = old;
    }
    assert.deepEqual(calls, [["repo", "--yes", "--login-mode", "browser"]]);
  });
});

test("install secret readiness explicit bootstrap runs repo bootstrap even when credentials exist", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    await writeCredentials(repoRoot);
    const resets: string[][] = [];
    const calls: string[][] = [];
    await ensureReadiness(repoRoot, {
      flags: { ...baseFlags, bootstrap: true, yes: true },
      deps: {
        resetLocal: async (args) => void resets.push(args),
        bootstrap: async (args) => void calls.push(args),
        isInteractive: () => false,
      },
    });
    assert.deepEqual(resets, []);
    assert.deepEqual(calls, [["repo", "--yes", "--login-mode", "browser"]]);
  });
});

test("install secret readiness interactive bootstrap warns and keeps local state by default", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    await writeCredentials(repoRoot);
    const resets: string[][] = [];
    const calls: string[][] = [];
    await ensureReadiness(repoRoot, {
      flags: { ...baseFlags, bootstrap: true },
      deps: {
        resetLocal: async (args) => {
          resets.push(args);
          return nonEmptyResetPlan();
        },
        bootstrap: async (args) => void calls.push(args),
        prompt: async (message) => {
          assert.match(message, /Reset local Infisical bootstrap state/);
          return false;
        },
        isInteractive: () => true,
        selectSecretBackend: async () => "",
      },
    });
    assert.deepEqual(resets, [["--dry-run"]]);
    assert.deepEqual(calls, [["repo", "--yes", "--login-mode", "browser"]]);
  });
});

test("install secret readiness interactive bootstrap resets local state when confirmed", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    await writeCredentials(repoRoot);
    const resets: string[][] = [];
    const calls: string[][] = [];
    await ensureReadiness(repoRoot, {
      flags: { ...baseFlags, bootstrap: true },
      deps: {
        resetLocal: async (args) => {
          resets.push(args);
          return nonEmptyResetPlan();
        },
        bootstrap: async (args) => void calls.push(args),
        prompt: async () => true,
        isInteractive: () => true,
        selectSecretBackend: async () => "",
      },
    });
    assert.deepEqual(resets, [["--dry-run"], ["--yes"]]);
    assert.deepEqual(calls, [["repo", "--yes", "--login-mode", "browser"]]);
  });
});

test("install secret readiness interactive bootstrap skips reset prompt when no local state exists", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    const resets: string[][] = [];
    const calls: string[][] = [];
    let prompted = false;
    await ensureReadiness(repoRoot, {
      flags: { ...baseFlags, bootstrap: true },
      deps: {
        resetLocal: async (args) => {
          resets.push(args);
          return { localItems: [], keychainItems: [] };
        },
        bootstrap: async (args) => void calls.push(args),
        prompt: async () => {
          prompted = true;
          return true;
        },
        isInteractive: () => true,
        selectSecretBackend: async () => "",
      },
    });
    assert.deepEqual(resets, [["--dry-run"]]);
    assert.equal(prompted, false);
    assert.deepEqual(calls, [["repo", "--yes", "--login-mode", "browser"]]);
  });
});

test("install secret readiness explicit bootstrap fails closed in non-interactive mode without yes", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    const calls: string[][] = [];
    await assert.rejects(
      ensureReadiness(repoRoot, {
        flags: { ...baseFlags, bootstrap: true },
        deps: {
          bootstrap: async (args) => void calls.push(args),
          isInteractive: () => false,
        },
      }),
      /--bootstrap --yes/,
    );
    assert.deepEqual(calls, []);
  });
});
