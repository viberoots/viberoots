#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { assertBootstrapPreflight } from "../../deployments/infisical-iac-bootstrap-preflight";
import { runInfisicalIacBootstrap } from "../../deployments/infisical-iac-bootstrap";
import {
  createCredentialSink,
  resolveCredentialSinkSelection,
} from "../../deployments/infisical-iac-bootstrap-sink";

test("bootstrap preflight rejects missing --yes before local or remote side effects", () => {
  const sideEffects: string[] = [];
  assert.throws(() => {
    assertBootstrapPreflight({ ...DEFAULT_BOOTSTRAP_ARGS, yes: false, dryRun: false });
    sideEffects.push("mutation");
  }, /requires --yes[\s\S]*No Infisical resources, OpenTofu state, resolver config, or credential sink output was changed/);
  assert.deepEqual(sideEffects, []);
});

test("bootstrap path rejects missing --yes before Infisical, OpenTofu, or sink writes", async () => {
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
            apiUrl: `http://127.0.0.1:${port}`,
            cliDomain: `http://127.0.0.1:${port}/api`,
            noLogin: true,
            dryRun: false,
            yes: false,
            tofuPlanFile: "side-effects/plan.tfplan",
            localCredentialFile: "side-effects/credentials.json",
          }),
        /requires --yes/,
      );
      assert.deepEqual(requests, []);
      await assertMissing("sprinkleref/selected.local.json");
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

test("bootstrap dry-run path does not create resolver config without --yes", async () => {
  const dir = await tmp();
  await writeReviewedMetadata(dir);
  await withCwdAndEnv(dir, async () => {
    const output = await captureStdout(() =>
      runInfisicalIacBootstrap({ ...DEFAULT_BOOTSTRAP_ARGS, dryRun: true, yes: false }),
    );
    const report = JSON.parse(output) as { credentialSinkDescription: string };
    assert.match(report.credentialSinkDescription, /starter config not created during dry-run/);
    await assert.rejects(() => fs.stat("sprinkleref/selected.local.json"), /ENOENT/);
  });
});

test("auto credential sink reuses existing SprinkleRef resolver config", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await fs.mkdir("sprinkleref", { recursive: true });
    await writeJson("sprinkleref/selected.local.json", {
      version: 1,
      defaultCategory: "bootstrap",
      categories: { bootstrap: { backend: "local-file", file: "kept-bootstrap.json" } },
    });
    const selection = await resolveCredentialSinkSelection(DEFAULT_BOOTSTRAP_ARGS, {
      platform: "linux",
      env: {},
    });
    assert.equal(selection.kind, "sprinkleref");
    assert.equal(selection.backend, "local-file");
    assert.equal(selection.configPath, "sprinkleref/selected.local.json");
    await assert.rejects(() => fs.stat("sprinkleref/base.json"), /ENOENT/);
  });
});

test("auto credential sink creates starter resolver config only when none exists", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    const sink = await createCredentialSink(DEFAULT_BOOTSTRAP_ARGS, {
      platform: "linux",
      env: {},
    });
    assert.match(sink.describe(), /SprinkleRef bootstrap local-file/);
    const selected = await fs.readFile("sprinkleref/selected.local.json", "utf8");
    assert.match(selected, /"backend": "local-file"/);
    assert.doesNotMatch(selected, /clientSecret":/);
  });
});

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-preflight-"));
}

async function withCwdAndEnv(dir: string, run: () => Promise<void>) {
  const cwd = process.cwd();
  const oldConfig = process.env.SPRINKLEREF_CONFIG;
  delete process.env.SPRINKLEREF_CONFIG;
  process.chdir(dir);
  try {
    await run();
  } finally {
    process.chdir(cwd);
    if (oldConfig === undefined) delete process.env.SPRINKLEREF_CONFIG;
    else process.env.SPRINKLEREF_CONFIG = oldConfig;
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
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
  const file = path.join(dir, "projects/deployments/pleomino-shared/family.bzl");
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

async function captureStdout(run: () => Promise<void>) {
  const original = console.log;
  const lines: string[] = [];
  console.log = (value?: unknown) => {
    lines.push(String(value));
  };
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}
