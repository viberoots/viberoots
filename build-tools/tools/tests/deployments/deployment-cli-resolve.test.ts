#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDeploymentForCli } from "../../deployments/deployment-cli-resolve";
import { runInTemp } from "../lib/test-helpers";
import { writeTempListedDeploymentWorkspace } from "./deploy.front-door.fixture";

async function withArgv<T>(args: string[], fn: () => Promise<T>): Promise<T> {
  const oldGlobal = (globalThis as { argv?: unknown }).argv;
  const oldArgv = process.argv.slice();
  delete (globalThis as { argv?: unknown }).argv;
  process.argv = ["node", "script", ...args];
  try {
    return await fn();
  } finally {
    process.argv = oldArgv;
    if (oldGlobal === undefined) delete (globalThis as { argv?: unknown }).argv;
    else (globalThis as { argv?: unknown }).argv = oldGlobal;
  }
}

test("deploy resolves a positional package label to its deploy target", async () => {
  await runInTemp("deployment-cli-positional-label", async (tmp) => {
    await writeTempListedDeploymentWorkspace(tmp);
    await withArgv(["//sandbox/deployments/demo-dev"], async () => {
      const deployment = await resolveDeploymentForCli(tmp, () => {
        throw new Error("unexpected --deployment lookup");
      });
      assert.equal(deployment.label, "//sandbox/deployments/demo-dev:deploy");
    });
  });
});

test("deploy resolves a relative filesystem path to its deploy target", async () => {
  await runInTemp("deployment-cli-positional-path", async (tmp) => {
    await writeTempListedDeploymentWorkspace(tmp);
    const oldCwd = process.cwd();
    try {
      process.chdir(tmp);
      await withArgv(["--validate-only", "sandbox/deployments/demo-dev"], async () => {
        const deployment = await resolveDeploymentForCli(tmp, () => {
          throw new Error("unexpected --deployment lookup");
        });
        assert.equal(deployment.label, "//sandbox/deployments/demo-dev:deploy");
      });
    } finally {
      process.chdir(oldCwd);
    }
  });
});

test("deploy rejects mixing --deployment with positional deployment selector", async () => {
  await runInTemp("deployment-cli-positional-conflict", async (tmp) => {
    await writeTempListedDeploymentWorkspace(tmp);
    await withArgv(
      ["--deployment", "//sandbox/deployments/demo-dev:deploy", "//sandbox/deployments/demo-dev"],
      async () => {
        await assert.rejects(
          () =>
            resolveDeploymentForCli(tmp, () => {
              throw new Error("unexpected --deployment lookup");
            }),
          /--deployment cannot be combined with a positional deployment selector/,
        );
      },
    );
  });
});

test("deploy ignores admin subcommand words when --deployment is present", async () => {
  await runInTemp("deployment-cli-admin-subcommand-positionals", async (tmp) => {
    await writeTempListedDeploymentWorkspace(tmp);
    await withArgv(
      ["admin", "identity", "grant-user", "--deployment", "//sandbox/deployments/demo-dev:deploy"],
      async () => {
        const deployment = await resolveDeploymentForCli(tmp, () => {
          throw new Error("unexpected --deployment lookup");
        });
        assert.equal(deployment.label, "//sandbox/deployments/demo-dev:deploy");
      },
    );
  });
});

test("deploy ignores admission check names when --deployment is present", async () => {
  await runInTemp("deployment-cli-admission-check-value", async (tmp) => {
    await writeTempListedDeploymentWorkspace(tmp);
    await withArgv(
      ["--deployment", "//sandbox/deployments/demo-dev:deploy", "--admit-only", "deploy/admission"],
      async () => {
        const deployment = await resolveDeploymentForCli(tmp, () => {
          throw new Error("unexpected --deployment lookup");
        });
        assert.equal(deployment.label, "//sandbox/deployments/demo-dev:deploy");
      },
    );
  });
});
