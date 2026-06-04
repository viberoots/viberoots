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

test("resolver config applies default category and rejects retired config forms", async () => {
  const dir = await tmp();
  const configPath = path.join(dir, "resolver.json");
  await writeJson(configPath, {
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
  const config = await readSprinkleRefConfig(configPath);
  assert.equal(resolveSprinkleRefBackend(config).backend.backend, "infisical");
  await writeJson(path.join(dir, "extends.json"), {
    version: 1,
    extends: "./resolver.json",
    defaultCategory: "main",
    categories: { main: { backend: "local-file", file: "main.json" } },
  });
  await assert.rejects(
    () => readSprinkleRefConfig(path.join(dir, "extends.json")),
    /extends is no longer supported/,
  );
  await assert.rejects(
    () => readSprinkleRefConfig(path.join(dir, "config/sprinkleref/selected.local.json")),
    /retired SprinkleRef resolver config path/,
  );
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
  assert.match(serialized, /github-actions/);
  assert.match(serialized, /bitbucket-pipelines/);
  assert.doesNotMatch(serialized, /clientSecret":/);
  assert.doesNotMatch(serialized, /pleomino-project-id|vault-default-placeholder/);
  assert.deepEqual(configs, sprinkleRefStarterConfigs("darwin"));
  const dir = await tmp();
  const written = await initSprinkleRefConfigs({ dir, platform: "linux" });
  assert.deepEqual(
    written.map((file) => path.basename(file)),
    ["shared.json"],
  );
  assert.match(await fs.readFile(path.join(dir, "shared.json"), "utf8"), /local-file/);
  const selected = await readSprinkleRefConfig(path.join(dir, "shared.json"));
  assert.equal(selected.defaultCategory, "control");
  const control = resolveSprinkleRefBackend(selected, "control");
  assert.equal(control.profile, "infisical-control");
  assert.equal(control.backend.backend, "infisical");
  assert.equal(control.backend.defaultEnvironment, "prod");
  assert.equal(selected.profiles["infisical-control"]?.defaultEnvironment, "staging");
  assert.equal(resolveSprinkleRefBackend(selected).profile, "infisical-control");
  const sharedPath = path.join(dir, "shared.json");
  const shared = JSON.parse(await fs.readFile(sharedPath, "utf8"));
  shared.environments.prod.infisicalEnvironment = "prod-alt";
  await writeJson(sharedPath, shared);
  assert.equal(
    resolveSprinkleRefBackend(await readSprinkleRefConfig(sharedPath), "control").backend
      .defaultEnvironment,
    "prod-alt",
  );
});

test("sprinkleref --init defaults to projects/config", async () => {
  const dir = await tmp();
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    await runSprinkleRefCli({ argv: ["--init"], stdout: () => undefined, platform: "linux" });
    assert.match(
      await fs.readFile(path.join(dir, "projects/config", "shared.json"), "utf8"),
      /local-file/,
    );
  } finally {
    process.chdir(cwd);
  }
});

test("repo ignore policy tracks shared project config and ignores local project config", () => {
  assert.equal(isGitIgnored("projects/config/shared.json"), false);
  assert.equal(isGitIgnored("projects/config/local.json"), true);
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
    execFileSync("git", ["check-ignore", "--no-index", "--quiet", relativePath], {
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
