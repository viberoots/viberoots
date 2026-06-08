#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import {
  assertBootstrapPreflight,
  confirmBootstrapPreflight,
  isAffirmativeConfirmation,
} from "../../deployments/infisical-iac-bootstrap-preflight";
import { runInfisicalIacBootstrap } from "../../deployments/infisical-iac-bootstrap";
import { withTempWorkspace } from "./infisical-iac-bootstrap.test-env";

test("bootstrap preflight rejects non-interactive execution before side effects", async () => {
  const sideEffects: string[] = [];
  await assert.rejects(async () => {
    await confirmBootstrapPreflight(
      { ...DEFAULT_BOOTSTRAP_ARGS, yes: false, dryRun: false },
      {
        stdin: { isTTY: false } as NodeJS.ReadStream,
        stdout: { isTTY: false } as NodeJS.WriteStream,
      },
    );
    sideEffects.push("mutation");
  }, /needs confirmation[\s\S]*Retry non-interactively:[\s\S]*--yes/);
  assert.deepEqual(sideEffects, []);
});

test("bootstrap preflight allows interactive confirmation without --yes", async () => {
  await confirmBootstrapPreflight(
    { ...DEFAULT_BOOTSTRAP_ARGS, yes: false, dryRun: false },
    {
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true } as NodeJS.WriteStream,
      question: async () => "yes",
    },
  );
});

test("bootstrap preflight accepts y or yes confirmation", () => {
  for (const answer of ["", "y", "Y", "yes", "YES"]) {
    assert.equal(isAffirmativeConfirmation(answer), true);
  }
  for (const answer of ["n", "N", "no", "sure"]) {
    assert.equal(isAffirmativeConfirmation(answer), false);
  }
});

test("bootstrap preflight cancellation stops before side effects", async () => {
  const sideEffects: string[] = [];
  await assert.rejects(async () => {
    await confirmBootstrapPreflight(
      { ...DEFAULT_BOOTSTRAP_ARGS, yes: false, dryRun: false },
      {
        stdin: { isTTY: true } as NodeJS.ReadStream,
        stdout: { isTTY: true } as NodeJS.WriteStream,
        question: async () => "no",
      },
    );
    sideEffects.push("mutation");
  }, /bootstrap cancelled/);
  assert.deepEqual(sideEffects, []);
});

test("bootstrap preflight retry command includes the explicit repo mode", () => {
  const message = bootstrapRetryMessage({ ...DEFAULT_BOOTSTRAP_ARGS, yes: false, dryRun: false });
  assert.match(message, /infisical-bootstrap\.ts repo .*--yes/);
  assert.doesNotMatch(message, /--tofu-dir|pleomino-infisical|OpenTofu/i);
});

test("bootstrap preflight retry command includes deployment target scope", () => {
  const message = bootstrapRetryMessage({
    ...DEFAULT_BOOTSTRAP_ARGS,
    mode: "deployment",
    target: "//projects/deployments/pleomino/staging:deploy",
    yes: false,
    dryRun: false,
  });
  assert.match(
    message,
    /infisical-bootstrap\.ts deployment --target \/\/projects\/deployments\/pleomino\/staging:deploy .*--yes/,
  );
  assert.doesNotMatch(message, /--tofu-dir|--tofu-plan-file|--local-credential-file/);
});

test("bootstrap path rejects non-interactive execution before Infisical, OpenTofu, or sink writes", async () => {
  const dir = await tmp();
  await writeReviewedMetadata(dir);
  const binDir = path.join(dir, "bin");
  const tofuMarker = path.join(dir, "tofu-called");
  await fs.mkdir(binDir, { recursive: true });
  await writeFakeTofu(path.join(binDir, "tofu"), tofuMarker);
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url || "");
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end("{}");
  });
  await listen(server);
  const port = (server.address() as { port: number }).port;
  const oldPath = process.env.PATH;
  const oldToken = process.env.INFISICAL_ACCESS_TOKEN;
  process.env.PATH = `${binDir}${path.delimiter}${oldPath || ""}`;
  process.env.INFISICAL_ACCESS_TOKEN = "sentinel-token";
  try {
    await withCwdAndEnv(dir, async () => {
      await assert.rejects(
        () =>
          runInfisicalIacBootstrap({
            ...DEFAULT_BOOTSTRAP_ARGS,
            mode: "deployment",
            target: "//projects/deployments/pleomino/staging:deploy",
            apiUrl: `http://127.0.0.1:${port}`,
            cliDomain: `http://127.0.0.1:${port}/api`,
            noLogin: true,
            dryRun: false,
            yes: false,
            tofuPlanFile: "side-effects/plan.tfplan",
            localCredentialFile: "side-effects/credentials.json",
          }),
        /needs confirmation/,
      );
      assert.deepEqual(requests, []);
      await assertMissing("projects/config/shared.json");
      await assertMissing("side-effects/credentials.json");
      await assertMissing("side-effects/plan.tfplan");
      await assertMissing(tofuMarker);
    });
  } finally {
    await close(server);
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldToken === undefined) delete process.env.INFISICAL_ACCESS_TOKEN;
    else process.env.INFISICAL_ACCESS_TOKEN = oldToken;
  }
});

test("deployment bootstrap rejects unsupported target selectors before reviewed metadata lookup", async () => {
  await assert.rejects(
    () =>
      runInfisicalIacBootstrap({
        ...DEFAULT_BOOTSTRAP_ARGS,
        mode: "deployment",
        target: "//projects/deployments/not-pleomino:deploy",
        dryRun: true,
      }),
    /target .* is not supported/,
  );
});

test("bootstrap dry-run path does not create resolver config without --yes", async () => {
  const dir = await tmp();
  await writeReviewedMetadata(dir);
  await withCwdAndEnv(dir, async () => {
    const output = await captureConsole(() =>
      runInfisicalIacBootstrap({ ...DEFAULT_BOOTSTRAP_ARGS, dryRun: true, yes: false }),
    );
    const report = JSON.parse(output.stdout) as { credentialSinkDescription?: unknown };
    assert.equal(report.credentialSinkDescription, undefined);
    assert.match(output.stderr, /starter config not created during dry-run/);
    await assert.rejects(() => fs.stat(sharedConfigPath()), /ENOENT/);
  });
});

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-preflight-"));

const sharedConfigPath = () => path.join("projects", "config", "shared.json");

async function withCwdAndEnv(dir: string, run: () => Promise<void>) {
  await withTempWorkspace(dir, run, { clearConfig: true });
}

function bootstrapRetryMessage(args: typeof DEFAULT_BOOTSTRAP_ARGS) {
  try {
    assertBootstrapPreflight(args);
  } catch (error) {
    return String((error as Error).message);
  }
  return "";
}

async function writeFakeTofu(file: string, marker: string) {
  await fs.writeFile(file, `#!/usr/bin/env bash\nprintf called > ${JSON.stringify(marker)}\n`);
  await fs.chmod(file, 0o755);
}

async function assertMissing(file: string) {
  await assert.rejects(() => fs.stat(file), /ENOENT/);
}

async function listen(server: http.Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function close(server: http.Server) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function writeReviewedMetadata(dir: string) {
  const file = path.join(dir, "projects/deployments/pleomino/shared/family.bzl");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    [
      '_INFISICAL_SITE_URL = "https://app.infisical.com"',
      '_INFISICAL_PROJECT_ID = "proj_pleomino"',
      '_INFISICAL_PROJECT_NAME = "pleomino-deployments"',
      '_INFISICAL_PROJECT_SLUG = "pleomino-deployments"',
      '_INFISICAL_ENVIRONMENT_SLUGS = {"staging": "staging", "prod": "prod"}',
      '_INFISICAL_SECRET_PATH = "/"',
      '_INFISICAL_CLOUDFLARE_SECRET_NAME = "cloudflare_api_token"',
      '_INFISICAL_MACHINE_IDENTITY_IDS = {"staging": "id_staging", "prod": "id_prod"}',
      '_INFISICAL_MACHINE_IDENTITY_NAMES = {"staging": "staging-deploy", "prod": "prod-deploy"}',
      '_INFISICAL_CREDENTIAL_FILE_NAMES = {"staging": {"client_id": "sid", "client_secret": "ssec"}, "prod": {"client_id": "pid", "client_secret": "psec"}}',
      '_INFISICAL_CREDENTIAL_REFS = {"staging": {"client_id": "secret://deployments/pleomino/staging/infisical-client-id", "client_secret": "secret://deployments/pleomino/staging/infisical-client-secret"}, "prod": {"client_id": "secret://deployments/pleomino/prod/infisical-client-id", "client_secret": "secret://deployments/pleomino/prod/infisical-client-secret"}}',
      "",
    ].join("\n"),
  );
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
