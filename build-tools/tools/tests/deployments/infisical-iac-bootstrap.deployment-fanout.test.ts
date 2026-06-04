#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { runInfisicalIacBootstrap } from "../../deployments/infisical-iac-bootstrap";
import {
  confirmDeploymentFanOut,
  discoverDeploymentBootstrapTargets,
  runDeploymentBootstrapFanOut,
} from "../../deployments/infisical-iac-bootstrap-deployments";

const staging = "//projects/deployments/pleomino/staging:deploy";
const prod = "//projects/deployments/pleomino/prod:deploy";

test("deployment fan-out discovery uses reviewed graph metadata", async () => {
  const graphPath = await graph([
    deploymentNode(staging, "pleomino"),
    deploymentNode(prod, "pleomino"),
    deploymentNode("//projects/deployments/other-prod:deploy", "other"),
  ]);
  const discovery = await discoverDeploymentBootstrapTargets({ graphPath });
  assert.deepEqual(discovery.offeredTargets, [prod, staging]);
  assert.deepEqual(discovery.unsupportedTargets, [
    {
      target: "//projects/deployments/other-prod:deploy",
      reason: "deployment does not match a reviewed Infisical bootstrap family",
    },
  ]);
  assert.equal(discovery.source, "graph");
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
    /Repo bootstrap completed[\s\S]*\/\/projects\/deployments\/pleomino\/prod:deploy: tofu apply failed[\s\S]*deployment --target <buck-target>/,
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

test("confirmed repo bootstrap performs repo setup before deployment fan-out prompt", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-repo-fanout-"));
  await writeRepoOnlyResolver(dir);
  await fs.mkdir(path.join(dir, "build-tools/tools/buck"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "build-tools/tools/buck/graph.json"),
    `${JSON.stringify({ nodes: [fanOutOnlyNode(staging)] }, null, 2)}\n`,
  );
  const output = await withInteractiveIo(["Y\n", "n\n"], async () => {
    await withCwd(dir, () =>
      runInfisicalIacBootstrap({
        ...DEFAULT_BOOTSTRAP_ARGS,
        mode: "repo",
        yes: false,
        credentialSink: "auto",
      }),
    );
  });
  assert.match(output, /infisical-repo-bootstrap-result@1/);
  assert.match(output, /Run deployment bootstrap for .*pleomino\/staging:deploy\? \[Y\/n\]/);
  assert.match(output, /Deployment bootstrap fan-out skipped by operator response/);
  assert.ok(output.indexOf("infisical-repo-bootstrap-result@1") < output.indexOf("Run deployment"));
  assert.equal(await fs.readFile(path.join(dir, ".local/bootstrap.json"), "utf8"), "{}\n");
});

test("repo dry-run reports non-empty deployment fan-out targets read-only", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-dry-run-fanout-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    await fs.mkdir("build-tools/tools/buck", { recursive: true });
    await fs.writeFile(
      "build-tools/tools/buck/graph.json",
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
    await assert.rejects(() => fs.stat(sharedConfigPath()), /ENOENT/);
  } finally {
    process.chdir(cwd);
  }
});

async function graph(nodes: unknown[]) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-fanout-"));
  const graphPath = path.join(dir, "graph.json");
  await fs.writeFile(graphPath, `${JSON.stringify({ nodes }, null, 2)}\n`);
  return graphPath;
}

function sharedConfigPath() {
  return path.join("projects", "config", "shared.json");
}

function deploymentNode(name: string, family: string) {
  return {
    name,
    rule_type: "deployment_target",
    deployment_family: family,
    environment_stage: "prod",
    secret_backend: "infisical/default",
    infisical_runtime: { project_id: "proj_1", environment: "prod" },
  };
}

function fanOutOnlyNode(name: string) {
  const node = deploymentNode(name, "pleomino");
  delete (node as { secret_backend?: string }).secret_backend;
  return node;
}

async function writeRepoOnlyResolver(dir: string) {
  await fs.mkdir(path.join(dir, "projects/config"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "projects/config/shared.json"),
    `${JSON.stringify(
      {
        schemaVersion: "viberoots-project-config@1",
        sprinkleref: {
          version: 1,
          defaultCategory: "main",
          categories: {
            main: { backend: "local-file", file: ".local/main.json" },
            bootstrap: { backend: "local-file", file: ".local/bootstrap.json" },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function withCwd<T>(dir: string, run: () => Promise<T>) {
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    return await run();
  } finally {
    process.chdir(cwd);
  }
}

async function withInteractiveIo(inputText: string[], run: () => Promise<void>) {
  const oldStdin = process.stdin;
  const oldStdout = process.stdout;
  const originalError = console.error;
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  Object.assign(input, { isTTY: true });
  Object.assign(output, { isTTY: true });
  output.on("data", (chunk) => chunks.push(String(chunk)));
  console.error = (value?: unknown) => chunks.push(`${String(value)}\n`);
  Object.defineProperty(process, "stdin", { value: input, configurable: true });
  Object.defineProperty(process, "stdout", { value: output, configurable: true });
  inputText.forEach((text, index) => {
    setTimeout(() => {
      input.write(text);
      if (index === inputText.length - 1) input.end();
    }, index * 20);
  });
  try {
    await run();
  } finally {
    Object.defineProperty(process, "stdin", { value: oldStdin, configurable: true });
    Object.defineProperty(process, "stdout", { value: oldStdout, configurable: true });
    console.error = originalError;
  }
  return chunks.join("");
}

async function captureConsole(run: () => Promise<void>) {
  const originalLog = console.log;
  const originalError = console.error;
  const stdout: string[] = [];
  const stderr: string[] = [];
  console.log = (value?: unknown) => stdout.push(String(value));
  console.error = (value?: unknown) => stderr.push(String(value));
  try {
    await run();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return { stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}
