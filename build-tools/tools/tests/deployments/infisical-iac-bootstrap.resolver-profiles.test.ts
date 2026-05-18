#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runInfisicalIacBootstrap } from "../../deployments/infisical-iac-bootstrap";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import {
  createCredentialSink,
  resolveCredentialSinkSelection,
} from "../../deployments/infisical-iac-bootstrap-sink";

test("auto credential sink reuses existing SprinkleRef resolver config", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
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

test("repo bootstrap auto credential sink creates starter resolver config only when none exists", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    const sink = await createCredentialSink(
      { ...DEFAULT_BOOTSTRAP_ARGS, mode: "repo" },
      { platform: "linux", env: {} },
    );
    assert.match(sink.describe(), /SprinkleRef bootstrap local-file/);
    const selected = await fs.readFile("sprinkleref/selected.local.json", "utf8");
    assert.match(selected, /"backend": "local-file"/);
    assert.doesNotMatch(selected, /clientSecret":/);
  });
});

test("repo bootstrap auto credential sink uses explicit create mode for starter resolver config", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await fs.mkdir("sprinkleref", { recursive: true });
    await fs.writeFile("sprinkleref/base.json", "operator-owned\n");
    await assert.rejects(
      () =>
        createCredentialSink(
          { ...DEFAULT_BOOTSTRAP_ARGS, mode: "repo" },
          { platform: "linux", env: {} },
        ),
      /EEXIST/,
    );
    assert.equal(await fs.readFile("sprinkleref/base.json", "utf8"), "operator-owned\n");
    await assertMissing("sprinkleref/selected.local.json");
  });
});

test("repo bootstrap creates and validates resolver profiles independent of credential sink", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await writeGraph([
      { name: "//deployments/vault:deploy", secret_backend: "vault" },
      { name: "//deployments/infisical:deploy", secret_backend: "infisical" },
    ]);
    const output = await captureStdout(() =>
      runInfisicalIacBootstrap({
        ...DEFAULT_BOOTSTRAP_ARGS,
        credentialSink: "local-file",
        yes: true,
      }),
    );
    assert.match(output, /infisical-repo-bootstrap-result@1/);
    assert.match(output, /vault-default/);
    assert.match(output, /infisical-default/);
    const report = JSON.parse(output) as {
      bootstrapCredentialSinks: Array<{ profile: string; credentialSinkBackend: string }>;
    };
    assert.equal(report.bootstrapCredentialSinks.length, 1);
    assert.equal(report.bootstrapCredentialSinks[0]?.profile, "infisical-default");
    assert.equal(report.bootstrapCredentialSinks[0]?.credentialSinkBackend, "local-file");
    const selected = await fs.readFile("sprinkleref/selected.local.json", "utf8");
    assert.match(selected, /"profile": "infisical-default"/);
  });
});

test("repo bootstrap validates non-default profiles selected by deployment metadata", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await writeJson("sprinkleref/selected.local.json", {
      version: 1,
      defaultCategory: "main",
      profiles: {
        "vault-default": { backend: "local-file", file: ".local/vault.json" },
        "infisical-default": {
          backend: "infisical",
          host: "https://app.infisical.com",
          projectId: "project",
          defaultEnvironment: "staging",
          clientIdEnv: "INFISICAL_CLIENT_ID",
          clientSecretEnv: "INFISICAL_CLIENT_SECRET",
        },
      },
      categories: {
        main: { profile: "infisical-default" },
        bootstrap: { backend: "local-file", file: ".local/bootstrap.json" },
      },
    });
    await writeGraph([
      {
        name: "//deployments/regulated:deploy",
        secret_backend: "infisical",
        secret_backend_profile: "infisical-regulated",
      },
    ]);
    await assert.rejects(
      () => runInfisicalIacBootstrap({ ...DEFAULT_BOOTSTRAP_ARGS, yes: true }),
      /missing profile infisical-regulated/,
    );
  });
});

test("repo bootstrap validates bootstrap category even with explicit credential sinks", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await writeJson("sprinkleref/selected.local.json", {
      version: 1,
      defaultCategory: "main",
      profiles: {
        "vault-default": { backend: "local-file", file: ".local/vault.json" },
        "infisical-default": {
          backend: "infisical",
          host: "https://app.infisical.com",
          projectId: "project",
          defaultEnvironment: "staging",
          clientIdEnv: "INFISICAL_CLIENT_ID",
          clientSecretEnv: "INFISICAL_CLIENT_SECRET",
        },
      },
      categories: {
        main: { profile: "infisical-default" },
        bootstrap: { profile: "infisical-default" },
      },
    });
    await writeGraph([{ name: "//deployments/infisical:deploy", secret_backend: "infisical" }]);
    for (const credentialSink of ["local-file", "macos-keychain"] as const) {
      await assert.rejects(
        () =>
          runInfisicalIacBootstrap({
            ...DEFAULT_BOOTSTRAP_ARGS,
            credentialSink,
            yes: true,
          }),
        /access credential sink category bootstrap must not use an Infisical profile[\s\S]*Remediate:/,
      );
    }
  });
});

test("bootstrap credentials cannot resolve through an Infisical backend or profile", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await writeJson("sprinkleref/selected.local.json", {
      version: 1,
      defaultCategory: "main",
      profiles: {
        "infisical-default": {
          backend: "infisical",
          host: "https://app.infisical.com",
          projectId: "project",
          defaultEnvironment: "staging",
          clientIdEnv: "INFISICAL_CLIENT_ID",
          clientSecretEnv: "INFISICAL_CLIENT_SECRET",
        },
      },
      categories: {
        main: { profile: "infisical-default" },
        bootstrap: { profile: "infisical-default" },
      },
    });
    await assert.rejects(
      () =>
        resolveCredentialSinkSelection(
          { ...DEFAULT_BOOTSTRAP_ARGS, credentialSink: "sprinkleref" },
          { platform: "linux", env: {} },
        ),
      /access credential sink category bootstrap must not use an Infisical profile[\s\S]*Remediate:/,
    );
  });
});

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-resolver-"));
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
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeGraph(nodes: unknown[]) {
  await writeJson(path.join("build-tools", "tools", "buck", "graph.json"), { nodes });
}

async function assertMissing(file: string) {
  await assert.rejects(() => fs.stat(file), /ENOENT/);
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
