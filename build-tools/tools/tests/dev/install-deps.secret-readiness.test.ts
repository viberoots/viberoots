#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import "./install-deps.secret-readiness.bootstrap-cases";
import {
  baseFlags,
  captureStderr,
  ensureReadiness,
  withRepo,
  writeCredentials,
  writeResolver,
} from "./install-deps.secret-readiness.fixture";

test("install secret readiness skips bootstrap when local Universal Auth credentials exist", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    await writeCredentials(repoRoot);
    const calls: string[][] = [];
    const stderr = await captureStderr(async () => {
      await ensureReadiness(repoRoot, {
        flags: baseFlags,
        deps: { bootstrap: async (args) => void calls.push(args), isInteractive: () => false },
      });
    });
    assert.deepEqual(calls, []);
    assert.equal(stderr, "");
  });
});

test("install secret readiness prompts when credentials are missing and forwards flags", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    const calls: string[][] = [];
    const stderr = await captureStderr(async () => {
      await ensureReadiness(repoRoot, {
        flags: {
          ...baseFlags,
          machineLabel: "dev-laptop",
          rotateBootstrapCredentials: true,
          rotateDeploymentCredentials: true,
          forceOverwriteLocalCredentials: true,
          infisicalProjectName: "shared-repo",
          bootstrapKeychainServiceName: "shared-repo-bootstrap",
          keychainServiceName: "shared-repo-main",
        },
        deps: {
          isInteractive: () => true,
          prompt: async (message) => {
            assert.equal(message, "Run repo bootstrap now? [Y/n, then Enter] ");
            return true;
          },
          bootstrap: async (args) => void calls.push(args),
          selectSecretBackend: async () => "",
        },
      });
    });
    assert.match(stderr, /Local secret readiness is not complete/);
    assert.match(stderr, /Infisical-backed selections use browser login/);
    assert.match(stderr, /starting repo bootstrap/);
    assert.deepEqual(calls, [
      [
        "repo",
        "--yes",
        "--machine-label",
        "dev-laptop",
        "--login-mode",
        "browser",
        "--infisical-project-name",
        "shared-repo",
        "--bootstrap-keychain-service-name",
        "shared-repo-bootstrap",
        "--keychain-service-name",
        "shared-repo-main",
        "--rotate-bootstrap-credentials",
        "--rotate-deployment-credentials",
        "--force-overwrite-local-credentials",
      ],
    ]);
  });
});

test("install secret readiness forwards explicit secret backend to repo bootstrap", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    const calls: string[][] = [];
    await ensureReadiness(repoRoot, {
      flags: { ...baseFlags, secretBackend: "vault/default" },
      deps: {
        isInteractive: () => true,
        prompt: async () => true,
        bootstrap: async (args) => void calls.push(args),
        selectSecretBackend: async () => "",
      },
    });
    assert.deepEqual(calls, [
      ["repo", "--yes", "--login-mode", "browser", "--secret-backend", "vault/default"],
    ]);
  });
});

test("install secret readiness forwards Infisical project reselection flag", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    const calls: string[][] = [];
    await ensureReadiness(repoRoot, {
      flags: { ...baseFlags, bootstrap: true, yes: true, selectInfisicalProject: true },
      deps: {
        isInteractive: () => false,
        bootstrap: async (args) => void calls.push(args),
      },
    });
    assert.deepEqual(calls, [
      ["repo", "--yes", "--login-mode", "browser", "--select-infisical-project"],
    ]);
  });
});

test("install secret readiness forwards interactive secret backend selection", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    const calls: string[][] = [];
    await ensureReadiness(repoRoot, {
      flags: baseFlags,
      deps: {
        isInteractive: () => true,
        prompt: async () => true,
        bootstrap: async (args) => void calls.push(args),
        selectSecretBackend: async () => "keychain/default",
      },
    });
    assert.deepEqual(calls, [
      ["repo", "--yes", "--login-mode", "browser", "--secret-backend", "keychain/default"],
    ]);
  });
});

test("install secret readiness retries after a failed bootstrap even when partial credentials exist", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    const calls: string[][] = [];
    await assert.rejects(
      ensureReadiness(repoRoot, {
        flags: baseFlags,
        deps: {
          isInteractive: () => true,
          prompt: async () => true,
          bootstrap: async (args) => {
            calls.push(args);
            throw new Error("Infisical project test-project was not found");
          },
          selectSecretBackend: async () => "infisical/default",
        },
      }),
      /Infisical project test-project was not found/,
    );
    await writeCredentials(repoRoot);
    calls.length = 0;
    const prompts: string[] = [];
    await ensureReadiness(repoRoot, {
      flags: baseFlags,
      deps: {
        isInteractive: () => true,
        prompt: async (message) => {
          prompts.push(message);
          return true;
        },
        bootstrap: async (args) => void calls.push(args),
        selectSecretBackend: async () => "infisical/default",
      },
    });
    assert.deepEqual(prompts, ["Run repo bootstrap now? [Y/n, then Enter] "]);
    assert.deepEqual(calls, [
      ["repo", "--yes", "--login-mode", "browser", "--secret-backend", "infisical/default"],
    ]);
    calls.length = 0;
    await ensureReadiness(repoRoot, {
      flags: baseFlags,
      deps: {
        isInteractive: () => false,
        bootstrap: async (args) => void calls.push(args),
      },
    });
    assert.deepEqual(calls, []);
  });
});

test("install secret readiness prompts when resolver config is missing", async () => {
  await withRepo(async (repoRoot) => {
    const calls: string[][] = [];
    await ensureReadiness(repoRoot, {
      flags: baseFlags,
      deps: {
        isInteractive: () => true,
        prompt: async () => true,
        bootstrap: async (args) => void calls.push(args),
        selectSecretBackend: async () => "",
      },
    });
    assert.deepEqual(calls, [["repo", "--yes", "--login-mode", "browser"]]);
  });
});

test("install secret readiness forwards explicit Infisical login mode to repo bootstrap", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    const calls: string[][] = [];
    await ensureReadiness(repoRoot, {
      flags: { ...baseFlags, infisicalLoginMode: "interactive" },
      deps: {
        isInteractive: () => true,
        prompt: async () => true,
        bootstrap: async (args) => void calls.push(args),
        selectSecretBackend: async () => "",
      },
    });
    assert.deepEqual(calls, [["repo", "--yes", "--login-mode", "interactive"]]);
  });
});

test("install secret readiness forwards explicit browser login mode to repo bootstrap", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    const calls: string[][] = [];
    await ensureReadiness(repoRoot, {
      flags: { ...baseFlags, infisicalLoginMode: "browser" },
      deps: {
        isInteractive: () => true,
        prompt: async () => true,
        bootstrap: async (args) => void calls.push(args),
        selectSecretBackend: async () => "",
      },
    });
    assert.deepEqual(calls, [["repo", "--yes", "--login-mode", "browser"]]);
  });
});
