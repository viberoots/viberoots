#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { runInfisicalIacBootstrap } from "../../deployments/infisical-iac-bootstrap";
import { runRepoBootstrap } from "../../deployments/infisical-iac-bootstrap-repo";
import {
  confirmDeploymentFanOut,
  discoverDeploymentBootstrapTargets,
  runDeploymentBootstrapFanOut,
} from "../../deployments/infisical-iac-bootstrap-deployments";
import {
  deploymentNode,
  fanOutOnlyNode,
  graph,
  graphIn,
  sampleWebappContextNode,
  promptOnlyFanOutNode,
  writeRepoOnlyResolver,
} from "./infisical-iac-bootstrap.fanout-helpers";
import {
  captureConsole,
  captureConsoleEvents,
  withCwd,
} from "./infisical-iac-bootstrap.deployment-fanout.helpers";

const staging = "//projects/deployments/sample-webapp/staging:deploy";
const prod = "//projects/deployments/sample-webapp/prod:deploy";

test("deployment fan-out discovery uses reviewed graph metadata", async () => {
  const graphPath = await graph([
    deploymentNode(staging, "sample-webapp"),
    deploymentNode(prod, "sample-webapp"),
    deploymentNode("//projects/deployments/other-prod:deploy", "other"),
  ]);
  const discovery = await discoverDeploymentBootstrapTargets({ graphPath });
  assert.deepEqual(discovery.offeredTargets, [prod, staging]);
  assert.deepEqual(discovery.unsupportedTargets, [
    {
      target: "//projects/deployments/other-prod:deploy",
      reason: "deployment target path does not match its reviewed deployment family",
    },
  ]);
  assert.equal(discovery.source, "graph");
});

test("deployment fan-out discovery applies Sample webapp deployment context defaults", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-context-fanout-"));
  await writeRepoOnlyResolver(dir);
  const graphPath = await graphIn(dir, [
    sampleWebappContextNode(staging, "sample-webapp-staging"),
    sampleWebappContextNode(prod, "sample-webapp-prod"),
  ]);
  const discovery = await discoverDeploymentBootstrapTargets({ graphPath, workspaceRoot: dir });
  assert.deepEqual(discovery.offeredTargets, [prod, staging]);
  assert.deepEqual(discovery.unsupportedTargets, []);
  assert.equal(discovery.source, "graph");
});

test("deployment fan-out discovery fails closed on conflicting deployment context", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-context-conflict-"));
  await writeRepoOnlyResolver(dir);
  const graphPath = await graphIn(dir, [
    {
      ...sampleWebappContextNode(staging, "sample-webapp-staging"),
      secret_backend: "vault/default",
    },
  ]);
  const discovery = await discoverDeploymentBootstrapTargets({ graphPath, workspaceRoot: dir });
  assert.deepEqual(discovery.offeredTargets, []);
  assert.equal(discovery.unsupportedTargets[0]?.target, staging);
  assert.match(
    discovery.unsupportedTargets[0]?.reason || "",
    /secret_backend vault\/default disagrees with deployment_context secretBackend infisical\/default/,
  );
});

test("repo --without-deployments skips discovery and execution", async () => {
  let discovered = false;
  let executed = false;
  const logs: string[] = [];
  const result = await runDeploymentBootstrapFanOut({
    args: { ...DEFAULT_BOOTSTRAP_ARGS, withoutDeployments: true },
    discover: async () => {
      discovered = true;
      return { offeredTargets: [staging], unsupportedTargets: [], source: "graph" };
    },
    execute: async () => {
      executed = true;
    },
    io: { stderr: (line) => logs.push(line) },
  });
  assert.equal(discovered, false);
  assert.equal(executed, false);
  assert.equal(result.skipped, true);
  assert.match(logs.join("\n"), /--without-deployments/);
});

test("--yes pre-confirms deployment fan-out and names target failures", async () => {
  const seen: string[] = [];
  await assert.rejects(
    () =>
      runDeploymentBootstrapFanOut({
        args: { ...DEFAULT_BOOTSTRAP_ARGS, yes: true },
        discover: async () => ({
          offeredTargets: [staging, prod],
          unsupportedTargets: [],
          source: "graph",
        }),
        execute: async (args) => {
          seen.push(args.target || "");
          if (args.target === prod) throw new Error("tofu apply failed");
        },
        io: { stderr: () => undefined },
      }),
    /Repo bootstrap completed[\s\S]*\/\/projects\/deployments\/sample-webapp\/prod:deploy: tofu apply failed[\s\S]*deployment --target <buck-target>/,
  );
  assert.deepEqual(seen, [staging, prod]);
});

test("interactive deployment fan-out can be declined after repo setup", async () => {
  assert.equal(
    await confirmDeploymentFanOut({ ...DEFAULT_BOOTSTRAP_ARGS, yes: false }, [staging], {
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true } as NodeJS.WriteStream,
      question: async () => "n",
    }),
    false,
  );
});

test("confirmed repo bootstrap performs repo setup before deployment fan-out execution", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-repo-fanout-"));
  await writeRepoOnlyResolver(dir);
  await fs.mkdir(path.join(dir, ".viberoots/workspace/buck"), { recursive: true });
  await fs.writeFile(
    path.join(dir, ".viberoots/workspace/buck/graph.json"),
    `${JSON.stringify({ nodes: [promptOnlyFanOutNode(staging)] }, null, 2)}\n`,
  );
  let repoReportSeenBeforeFanOut = false;
  const output = await captureConsole(
    async () => {
      await withCwd(dir, () =>
        runRepoBootstrap(
          {
            ...DEFAULT_BOOTSTRAP_ARGS,
            mode: "repo",
            yes: true,
            credentialSink: "auto",
          },
          async (deploymentArgs) => {
            assert.equal(deploymentArgs.target, staging);
            assert.equal(repoReportSeenBeforeFanOut, true);
          },
          { finalCheckRunner: async () => 0 },
        ),
      );
    },
    {
      stdout: (value) => {
        if (String(value).includes("infisical-repo-bootstrap-result@1")) {
          repoReportSeenBeforeFanOut = true;
        }
      },
    },
  );
  assert.match(output.stdout, /infisical-repo-bootstrap-result@1/);
  assert.equal(await fs.readFile(path.join(dir, ".local/bootstrap.json"), "utf8"), "{}\n");
});

test("interactive repo bootstrap prompts for deployment fan-out after repo setup", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-repo-fanout-prompt-"));
  await writeRepoOnlyResolver(dir);
  await fs.mkdir(path.join(dir, ".viberoots/workspace/buck"), { recursive: true });
  await fs.writeFile(
    path.join(dir, ".viberoots/workspace/buck/graph.json"),
    `${JSON.stringify({ nodes: [promptOnlyFanOutNode(staging)] }, null, 2)}\n`,
  );
  const answers = ["Y", "n"];
  const events = await captureConsoleEvents(async (event) => {
    await withCwd(dir, () =>
      runRepoBootstrap(
        {
          ...DEFAULT_BOOTSTRAP_ARGS,
          mode: "repo",
          yes: false,
          credentialSink: "auto",
        },
        async () => undefined,
        {
          io: {
            stdin: { isTTY: true } as NodeJS.ReadStream,
            stdout: { isTTY: true } as NodeJS.WriteStream,
            question: async (prompt) => {
              event(prompt);
              return answers.shift() || "";
            },
          },
        },
      ),
    );
  });
  const output = events.join("\n");
  assert.deepEqual(answers, []);
  assert.match(output, /infisical-repo-bootstrap-result@1/);
  assert.match(output, /Run deployment bootstrap for .*sample-webapp\/staging:deploy\? \[Y\/n\]/);
  assert.match(output, /Deployment bootstrap fan-out skipped by operator response/);
  assert.ok(output.indexOf("infisical-repo-bootstrap-result@1") < output.indexOf("Run deployment"));
  assert.equal(await fs.readFile(path.join(dir, ".local/bootstrap.json"), "utf8"), "{}\n");
});

test("repo dry-run reports non-empty deployment fan-out targets read-only", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-dry-run-fanout-"));
  await writeRepoOnlyResolver(dir);
  const cwd = process.cwd();
  const oldEnv = { ...process.env };
  process.chdir(dir);
  process.env.WORKSPACE_ROOT = dir;
  process.env._VIBEROOTS_DEVSHELL_ROOT = dir;
  process.env.LIVE_ROOT = dir;
  try {
    await fs.mkdir(".viberoots/workspace/buck", { recursive: true });
    await fs.writeFile(
      ".viberoots/workspace/buck/graph.json",
      `${JSON.stringify({ nodes: [fanOutOnlyNode(staging)] }, null, 2)}\n`,
    );
    const output = await captureConsole(() =>
      runInfisicalIacBootstrap({ ...DEFAULT_BOOTSTRAP_ARGS, mode: "repo", dryRun: true }),
    );
    const report = JSON.parse(output.stdout) as {
      deploymentFanOut?: { readOnly?: boolean; offeredTargets?: string[] };
    };
    assert.equal(report.deploymentFanOut?.readOnly, true);
    assert.deepEqual(report.deploymentFanOut?.offeredTargets, [staging]);
    await assert.rejects(() => fs.stat(path.join(".local", "bootstrap.json")), /ENOENT/);
  } finally {
    process.chdir(cwd);
    process.env = oldEnv;
  }
});
