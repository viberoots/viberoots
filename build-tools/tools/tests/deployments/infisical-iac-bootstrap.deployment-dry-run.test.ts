#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { runInfisicalIacBootstrap } from "../../deployments/infisical-iac-bootstrap";

test("deployment bootstrap dry-run with auto sink remains read-only", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-dry-run-"));
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
    const output = await withCwd(dir, () =>
      captureStdout(() =>
        runInfisicalIacBootstrap({
          ...DEFAULT_BOOTSTRAP_ARGS,
          mode: "deployment",
          target: "//projects/deployments/pleomino/staging:deploy",
          apiUrl: `http://127.0.0.1:${port}`,
          cliDomain: `http://127.0.0.1:${port}/api`,
          hostOverride: true,
          credentialSink: "auto",
          dryRun: true,
          yes: false,
          tofuPlanFile: "side-effects/plan.tfplan",
          localCredentialFile: "side-effects/credentials.json",
        }),
      ),
    );
    assert.match(output, /"mode": "deployment"/);
    assert.deepEqual(requests, []);
    await assertMissing(path.join(dir, "projects/config/shared.json"));
    await assertMissing(path.join(dir, "side-effects/credentials.json"));
    await assertMissing(path.join(dir, "side-effects/plan.tfplan"));
    await assertMissing(tofuMarker);
  } finally {
    await close(server);
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});

test("deployment dry-run auto sink reads resolver config from workspace root", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-dry-run-"));
  const nested = path.join(dir, "projects", "deployments", "nested");
  await fs.mkdir(nested, { recursive: true });
  await writeReviewedMetadata(dir);
  await writeJson(path.join(dir, "projects/config/shared.json"), resolverConfig("root"));
  await writeJson(path.join(nested, "projects/config/shared.json"), keychainResolverConfig());
  const output = await withCwd(nested, () =>
    captureConsole(() =>
      runInfisicalIacBootstrap({
        ...DEFAULT_BOOTSTRAP_ARGS,
        mode: "deployment",
        target: "//projects/deployments/pleomino/staging:deploy",
        hostOverride: true,
        credentialSink: "auto",
        dryRun: true,
        yes: false,
      }),
    ),
  );
  assert.match(output.stderr, /bootstrap -> local-file/);
  assert.doesNotMatch(output.stderr, /bootstrap -> macos-keychain/);
});

async function withCwd<T>(dir: string, run: () => Promise<T>) {
  const cwd = process.cwd();
  const oldConfig = process.env.SPRINKLEREF_CONFIG;
  const oldWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const oldDevshellRoot = process.env._VIBEROOTS_DEVSHELL_ROOT;
  const oldLiveRoot = process.env.LIVE_ROOT;
  process.chdir(dir);
  delete process.env.SPRINKLEREF_CONFIG;
  process.env.WORKSPACE_ROOT = workspaceRootForTemp(dir);
  process.env._VIBEROOTS_DEVSHELL_ROOT = workspaceRootForTemp(dir);
  process.env.LIVE_ROOT = workspaceRootForTemp(dir);
  try {
    return await run();
  } finally {
    process.chdir(cwd);
    if (oldConfig === undefined) delete process.env.SPRINKLEREF_CONFIG;
    else process.env.SPRINKLEREF_CONFIG = oldConfig;
    if (oldWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = oldWorkspaceRoot;
    if (oldDevshellRoot === undefined) delete process.env._VIBEROOTS_DEVSHELL_ROOT;
    else process.env._VIBEROOTS_DEVSHELL_ROOT = oldDevshellRoot;
    if (oldLiveRoot === undefined) delete process.env.LIVE_ROOT;
    else process.env.LIVE_ROOT = oldLiveRoot;
  }
}

function workspaceRootForTemp(dir: string) {
  const marker = `${path.sep}projects${path.sep}deployments${path.sep}`;
  const markerIndex = dir.indexOf(marker);
  return markerIndex >= 0 ? dir.slice(0, markerIndex) : dir;
}

async function captureStdout(run: () => Promise<void>) {
  const original = console.log;
  const lines: string[] = [];
  console.log = (value?: unknown) => lines.push(String(value));
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
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

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function resolverConfig(prefix: string) {
  return {
    sprinkleref: {
      version: 1,
      defaultCategory: "bootstrap",
      categories: {
        bootstrap: {
          backend: "local-file",
          file: `${prefix}-bootstrap.json`,
        },
      },
    },
  };
}

function keychainResolverConfig() {
  return {
    sprinkleref: {
      version: 1,
      defaultCategory: "bootstrap",
      categories: {
        bootstrap: {
          backend: "macos-keychain",
          service: "nested-bootstrap",
        },
      },
    },
  };
}
