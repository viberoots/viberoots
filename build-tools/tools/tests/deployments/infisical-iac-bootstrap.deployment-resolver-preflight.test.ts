#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { runInfisicalIacBootstrap } from "../../deployments/infisical-iac-bootstrap";
import { withTempWorkspace } from "./infisical-iac-bootstrap.test-env";

test("deployment bootstrap rejects unsafe auto resolver before remote mutation", async () => {
  for (const [name, config, pattern] of [
    [
      "unsafe",
      unsafeInfisicalBootstrapConfig(),
      /access credential sink category bootstrap must not use an Infisical backend/,
    ],
    ["missing", missingBootstrapConfig(), /category bootstrap is not configured[\s\S]*Remediate:/],
  ] as const) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-resolver-"));
    await writeReviewedMetadata(dir);
    const configPath = path.join(dir, `${name}-resolver.json`);
    await writeJson(configPath, config);
    const requests: string[] = [];
    const server = http.createServer((request, response) => {
      requests.push(request.url || "");
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end("{}");
    });
    await listen(server);
    const port = (server.address() as { port: number }).port;
    try {
      await withCwdAndConfig(dir, configPath, async () => {
        await assert.rejects(
          () =>
            runInfisicalIacBootstrap({
              ...DEFAULT_BOOTSTRAP_ARGS,
              mode: "deployment",
              target: "//projects/deployments/sample-webapp/staging:deploy",
              apiUrl: `http://127.0.0.1:${port}`,
              cliDomain: `http://127.0.0.1:${port}/api`,
              hostOverride: true,
              noLogin: true,
              dryRun: false,
              yes: true,
            }),
          pattern,
        );
        assert.deepEqual(requests, []);
      });
    } finally {
      await close(server);
    }
  }
});

test("deployment bootstrap creates missing auto resolver before remote mutation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-resolver-"));
  await writeReviewedMetadata(dir);
  const binDir = path.join(dir, "bin");
  const tofuMarker = path.join(dir, "tofu-called");
  await fs.mkdir(binDir, { recursive: true });
  await writeFakeTofu(path.join(binDir, "tofu"), tofuMarker);
  let resolverExistedAtFirstRequest = false;
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url || "");
    resolverExistedAtFirstRequest = fsSync.existsSync(
      path.join(dir, "projects/config", "shared.json"),
    );
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
    await withCwdWithoutConfig(dir, async () => {
      await assert.rejects(
        () =>
          runInfisicalIacBootstrap({
            ...DEFAULT_BOOTSTRAP_ARGS,
            mode: "deployment",
            target: "//projects/deployments/sample-webapp/staging:deploy",
            apiUrl: `http://127.0.0.1:${port}`,
            cliDomain: `http://127.0.0.1:${port}/api`,
            hostOverride: true,
            noLogin: true,
            dryRun: false,
            yes: true,
            tofuPlanFile: "side-effects/plan.tfplan",
            localCredentialFile: "side-effects/credentials.json",
          }),
        /Infisical API GET \/api\/v1\/organization failed/,
      );
      assert.ok(requests.length > 0);
      assert.equal(resolverExistedAtFirstRequest, true);
      await fs.stat(sharedConfigPath());
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

test("deployment bootstrap remediates missing project config before remote mutation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-resolver-"));
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
  process.env.PATH = `${binDir}${path.delimiter}${oldPath || ""}`;
  try {
    await withCwdAndConfig(dir, path.join(dir, "missing-resolver.json"), async () => {
      await assert.rejects(
        () =>
          runInfisicalIacBootstrap({
            ...DEFAULT_BOOTSTRAP_ARGS,
            mode: "deployment",
            target: "//projects/deployments/sample-webapp/staging:deploy",
            apiUrl: `http://127.0.0.1:${port}`,
            cliDomain: `http://127.0.0.1:${port}/api`,
            hostOverride: true,
            noLogin: true,
            dryRun: false,
            yes: true,
            tofuPlanFile: "side-effects/plan.tfplan",
            localCredentialFile: "side-effects/credentials.json",
          }),
        /resolver config not found:[\s\S]*Remediate:/,
      );
      assert.deepEqual(requests, []);
      await assertMissing("side-effects/credentials.json");
      await assertMissing("side-effects/plan.tfplan");
      await assertMissing(tofuMarker);
    });
  } finally {
    await close(server);
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});

function unsafeInfisicalBootstrapConfig() {
  return JSON.parse(
    '{"version":1,"defaultCategory":"bootstrap","categories":{"bootstrap":{"backend":"infisical","host":"https://app.infisical.com","projectId":"proj_123","defaultEnvironment":"prod","clientIdEnv":"INFISICAL_CLIENT_ID","clientSecretEnv":"INFISICAL_CLIENT_SECRET"}}}',
  );
}

const sharedConfigPath = () => path.join("projects", "config", "shared.json");

function missingBootstrapConfig() {
  return JSON.parse(
    '{"version":1,"defaultCategory":"main","categories":{"main":{"backend":"local-file","file":"main.json"}}}',
  );
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function withCwdAndConfig(dir: string, configPath: string, run: () => Promise<void>) {
  await withTempWorkspace(dir, run, { configPath });
}

async function withCwdWithoutConfig(dir: string, run: () => Promise<void>) {
  await withTempWorkspace(dir, run, { clearConfig: true });
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
  const file = path.join(dir, "projects/deployments/sample-webapp/shared/family.bzl");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    [
      '_INFISICAL_SITE_URL = "https://app.infisical.com"',
      '_INFISICAL_PROJECT_ID = "proj_sample_webapp"',
      '_INFISICAL_PROJECT_NAME = "sample-webapp-deployments"',
      '_INFISICAL_PROJECT_SLUG = "sample-webapp-deployments"',
      '_INFISICAL_ENVIRONMENT_SLUGS = {"staging": "staging", "prod": "prod"}',
      '_INFISICAL_SECRET_PATH = "/"',
      '_INFISICAL_CLOUDFLARE_SECRET_NAME = "cloudflare_api_token"',
      '_INFISICAL_MACHINE_IDENTITY_IDS = {"staging": "id_staging", "prod": "id_prod"}',
      '_INFISICAL_MACHINE_IDENTITY_NAMES = {"staging": "staging-deploy", "prod": "prod-deploy"}',
      '_INFISICAL_CREDENTIAL_FILE_NAMES = {"staging": {"client_id": "sid", "client_secret": "ssec"}, "prod": {"client_id": "pid", "client_secret": "psec"}}',
      '_INFISICAL_CREDENTIAL_REFS = {"staging": {"client_id": "secret://deployments/sample-webapp/staging/infisical-client-id", "client_secret": "secret://deployments/sample-webapp/staging/infisical-client-secret"}, "prod": {"client_id": "secret://deployments/sample-webapp/prod/infisical-client-id", "client_secret": "secret://deployments/sample-webapp/prod/infisical-client-secret"}}',
      "",
    ].join("\n"),
  );
}
