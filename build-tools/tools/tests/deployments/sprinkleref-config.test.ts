#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runSprinkleRefCli } from "../../deployments/sprinkleref-cli";
import {
  assertBackendNeutralSecretRef,
  readSprinkleRefConfig,
  resolveSprinkleRefBackend,
} from "../../deployments/sprinkleref-config";
import {
  initSprinkleRefConfigs,
  sprinkleRefStarterConfigs,
} from "../../deployments/sprinkleref-templates";

test("resolver config applies default category and extends base categories", async () => {
  const dir = await tmp();
  await writeJson(path.join(dir, "base.json"), {
    version: 1,
    defaultCategory: "main",
    categories: {
      main: {
        backend: "infisical",
        host: "http://127.0.0.1:1",
        projectId: "proj",
        defaultEnvironment: "staging",
        clientIdEnv: "INFISICAL_CLIENT_ID",
        clientSecretEnv: "INFISICAL_CLIENT_SECRET",
      },
    },
  });
  const configPath = path.join(dir, "local.json");
  await writeJson(configPath, {
    version: 1,
    extends: "./base.json",
    categories: { bootstrap: { backend: "local-file", file: path.join(dir, "secrets.json") } },
  });
  const config = await readSprinkleRefConfig(configPath);
  assert.equal(resolveSprinkleRefBackend(config).backend.backend, "infisical");
  assert.equal(resolveSprinkleRefBackend(config, "bootstrap").backend.backend, "local-file");
});

test("resolver config resolves categories through named backend profiles", async () => {
  const dir = await tmp();
  const configPath = path.join(dir, "profiles.json");
  await writeJson(configPath, {
    version: 1,
    defaultCategory: "main",
    profiles: {
      "infisical-default": {
        backend: "infisical",
        host: "http://127.0.0.1:1",
        projectId: "proj",
        defaultEnvironment: "staging",
        clientIdEnv: "INFISICAL_CLIENT_ID",
        clientSecretEnv: "INFISICAL_CLIENT_SECRET",
      },
      "vault-default": vaultProfile(),
    },
    categories: {
      main: { profile: "infisical-default" },
      bootstrap: { profile: "vault-default" },
    },
  });
  const config = await readSprinkleRefConfig(configPath);
  assert.equal(resolveSprinkleRefBackend(config, "main").profile, "infisical-default");
  assert.equal(resolveSprinkleRefBackend(config, "bootstrap").backend.backend, "vault");
});

test("resolver config rejects unsupported backends and backend-specific refs", async () => {
  assert.throws(
    () => assertBackendNeutralSecretRef("secret://github/deployments/token"),
    /backend-neutral/,
  );
  assert.throws(
    () => assertBackendNeutralSecretRef("secret://deployments/pleomino/github/token"),
    /backend-neutral/,
  );
  const dir = await tmp();
  const configPath = path.join(dir, "bad.json");
  await writeJson(configPath, {
    version: 1,
    defaultCategory: "main",
    categories: { main: { backend: "unsupported" } },
  });
  await assert.rejects(() => readSprinkleRefConfig(configPath), /unsupported backend/);
});

test("resolver config rejects Infisical projectRef and requires projectId", async () => {
  const dir = await tmp();
  const configPath = path.join(dir, "project-ref.json");
  await writeJson(configPath, {
    version: 1,
    defaultCategory: "main",
    categories: {
      main: {
        backend: "infisical",
        host: "http://127.0.0.1:1",
        projectRef: "secret://deployments/pleomino/project-id",
        defaultEnvironment: "staging",
        clientIdEnv: "INFISICAL_CLIENT_ID",
        clientSecretEnv: "INFISICAL_CLIENT_SECRET",
      },
    },
  });
  await assert.rejects(
    () => readSprinkleRefConfig(configPath),
    /unsupported projectRef; use projectId/,
  );
});

test("resolver config rejects missing default and requested categories", async () => {
  const dir = await tmp();
  const configPath = path.join(dir, "missing-default.json");
  await writeJson(configPath, {
    version: 1,
    defaultCategory: "main",
    categories: { bootstrap: { backend: "local-file", file: path.join(dir, "secrets.json") } },
  });
  await assert.rejects(() => readSprinkleRefConfig(configPath), /missing default category main/);
  const validPath = path.join(dir, "valid.json");
  await writeJson(validPath, {
    version: 1,
    defaultCategory: "main",
    categories: { main: { backend: "local-file", file: path.join(dir, "main.json") } },
  });
  const config = await readSprinkleRefConfig(validPath);
  assert.throws(() => resolveSprinkleRefBackend(config, "bootstrap"), /not configured/);
});

test("starter configs are deterministic and contain no secret values", async () => {
  const configs = sprinkleRefStarterConfigs("darwin");
  const serialized = JSON.stringify(configs);
  assert.match(serialized, /macos-keychain/);
  assert.doesNotMatch(serialized, /clientSecret":/);
  assert.doesNotMatch(serialized, /pleomino-project-id|vault-default-placeholder/);
  assert.deepEqual(configs, sprinkleRefStarterConfigs("darwin"));
  const dir = await tmp();
  const written = await initSprinkleRefConfigs({ dir, platform: "linux" });
  assert.ok(written.some((file) => file.endsWith("ci.github.json")));
  assert.match(await fs.readFile(path.join(dir, "selected.json"), "utf8"), /local-file/);
  const selected = await readSprinkleRefConfig(path.join(dir, "selected.json"));
  assert.equal(selected.defaultCategory, "control");
  const control = resolveSprinkleRefBackend(selected, "control");
  assert.equal(control.profile, "infisical-control");
  assert.equal(control.backend.backend, "infisical");
  assert.equal(control.backend.defaultEnvironment, "prod");
  assert.equal(resolveSprinkleRefBackend(selected).profile, "infisical-control");
});

test("CI resolver templates parse each bootstrap mapping without remote writes", async () => {
  const dir = await tmp();
  await initSprinkleRefConfigs({ dir, platform: "linux" });
  const expected = {
    "ci.github.json": "github-actions",
    "ci.jenkins.json": "jenkins",
    "ci.gitlab.json": "gitlab-ci",
    "ci.bitbucket.json": "bitbucket-pipelines",
  };
  for (const [file, backend] of Object.entries(expected)) {
    const config = await readSprinkleRefConfig(path.join(dir, file));
    assert.equal(resolveSprinkleRefBackend(config, "bootstrap").backend.backend, backend);
  }
});

test("sprinkleref --init defaults to the sprinkleref directory", async () => {
  const dir = await tmp();
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    await runSprinkleRefCli({ argv: ["--init"], stdout: () => undefined, platform: "linux" });
    assert.match(
      await fs.readFile(path.join(dir, "config/sprinkleref", "selected.json"), "utf8"),
      /local-file/,
    );
  } finally {
    process.chdir(cwd);
  }
});

test("repo ignore policy tracks shared resolver config and ignores local values", () => {
  assert.equal(isGitIgnored("config/sprinkleref/base.json"), false);
  assert.equal(isGitIgnored("config/sprinkleref/selected.json"), false);
  assert.equal(isGitIgnored("config/sprinkleref/local/values.json"), true);
});

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-config-"));
}

async function writeJson(file: string, value: unknown) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function vaultProfile() {
  return {
    backend: "vault",
    addressEnv: "VBR_VAULT_ADDR",
    tokenEnv: "VBR_VAULT_TOKEN",
    mount: "secret",
    defaultPath: "/deployments",
  };
}

function isGitIgnored(relativePath: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "--quiet", relativePath], {
      cwd: process.cwd(),
      stdio: "ignore",
    });
    return true;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) return false;
    throw error;
  }
}
