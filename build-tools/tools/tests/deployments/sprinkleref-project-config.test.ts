#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  readSprinkleRefConfig,
  resolveSprinkleRefBackend,
} from "../../deployments/sprinkleref-config";
import { initSprinkleRefConfigs } from "../../deployments/sprinkleref-templates";

test("project config selects multiple runtime hosts from the shared profile set", async () => {
  const dir = await tmp();
  await initSprinkleRefConfigs({ dir: path.join(dir, "projects/config"), platform: "linux" });
  const expected = {
    GITHUB_ACTIONS: "github-actions",
    JENKINS_URL: "jenkins",
    GITLAB_CI: "gitlab-ci",
    BITBUCKET_BUILD_NUMBER: "bitbucket-pipelines",
  };
  for (const [envKey, backend] of Object.entries(expected)) {
    const old = process.env[envKey];
    process.env[envKey] = "1";
    try {
      const config = await readSprinkleRefConfig(undefined, dir);
      assert.equal(resolveSprinkleRefBackend(config, "bootstrap").backend.backend, backend);
    } finally {
      if (old === undefined) delete process.env[envKey];
      else process.env[envKey] = old;
    }
  }
  const oldHost = process.env.VBR_SPRINKLEREF_RUNTIME_HOST;
  process.env.VBR_SPRINKLEREF_RUNTIME_HOST = "local-file";
  try {
    const config = await readSprinkleRefConfig(undefined, dir);
    assert.throws(() => resolveSprinkleRefBackend(config, "bootstrap"), /not configured/);
  } finally {
    if (oldHost === undefined) delete process.env.VBR_SPRINKLEREF_RUNTIME_HOST;
    else process.env.VBR_SPRINKLEREF_RUNTIME_HOST = oldHost;
  }
  await writeJson(path.join(dir, "projects/config/local.json"), {
    activeRuntimeHost: "local-macos",
    runtimeHosts: {
      "local-file": {
        backend: "local-file",
        file: ".local/bootstrap.json",
      },
    },
  });
  const localSelected = await readSprinkleRefConfig(undefined, dir);
  assert.equal(
    resolveSprinkleRefBackend(localSelected, "bootstrap").backend.backend,
    "macos-keychain",
  );
  const localFile = withEnv("VBR_SPRINKLEREF_RUNTIME_HOST", "local-file", () =>
    readSprinkleRefConfig(undefined, dir),
  );
  assert.equal(
    resolveSprinkleRefBackend(await localFile, "bootstrap").backend.file,
    ".local/bootstrap.json",
  );
});

test("project local config always overrides shared values and records changed overlap paths", async () => {
  const dir = await tmp();
  await writeJson(path.join(dir, "projects/config/shared.json"), {
    schemaVersion: "viberoots-project-config@1",
    sprinkleref: {
      version: 1,
      defaultCategory: "main",
      categories: {
        main: {
          backend: "infisical",
          host: "https://shared.example",
          projectId: "shared-project",
          defaultEnvironment: "staging",
          clientIdEnv: "INFISICAL_CLIENT_ID",
          clientSecretEnv: "INFISICAL_CLIENT_SECRET",
        },
      },
    },
    values: { control: { token: "shared-token", region: "us-east-1" } },
  });
  await writeJson(path.join(dir, "projects/config/local.json"), {
    sprinkleref: {
      categories: {
        main: {
          backend: "infisical",
          host: "https://local.example",
          projectId: "local-project",
          defaultEnvironment: "staging",
          clientIdEnv: "INFISICAL_CLIENT_ID",
          clientSecretEnv: "INFISICAL_CLIENT_SECRET",
        },
      },
    },
    values: { control: { token: "local-token", region: "us-west-2" } },
  });
  const config = await readSprinkleRefConfig(undefined, dir);
  const backend = resolveSprinkleRefBackend(config, "main").backend;
  assert.equal(backend.backend, "infisical");
  assert.equal(backend.host, "https://local.example");
  assert.equal(backend.projectId, "local-project");
  assert.deepEqual(config.overrides?.map((entry) => entry.path).sort(), [
    "sprinkleref.categories.main.host",
    "sprinkleref.categories.main.projectId",
    "values.control.region",
    "values.control.token",
  ]);
  const explicit = await readSprinkleRefConfig("projects/config/shared.json", dir);
  assert.equal(resolveSprinkleRefBackend(explicit, "main").backend.host, "https://local.example");
  assert.deepEqual(explicit.overrides?.map((entry) => entry.path).sort(), [
    "sprinkleref.categories.main.host",
    "sprinkleref.categories.main.projectId",
    "values.control.region",
    "values.control.token",
  ]);
});

test("project local config safety guard rejects active overrides but allows fills", async () => {
  const dir = await tmp();
  await writeJson(path.join(dir, "projects/config/shared.json"), {
    schemaVersion: "viberoots-project-config@1",
    sprinkleref: {
      version: 1,
      defaultCategory: "main",
      categories: {
        main: {
          backend: "local-file",
          file: path.join(dir, "shared.json"),
        },
      },
    },
  });
  await writeJson(path.join(dir, "projects/config/local.json"), {
    values: { control: { account: "123" } },
  });
  const old = process.env.VBR_DISALLOW_LOCAL_OVERRIDES;
  process.env.VBR_DISALLOW_LOCAL_OVERRIDES = "1";
  try {
    await readSprinkleRefConfig(undefined, dir);
    await writeJson(path.join(dir, "projects/config/local.json"), {
      sprinkleref: {
        categories: {
          main: {
            backend: "local-file",
            file: path.join(dir, "local.json"),
          },
        },
      },
    });
    await assert.rejects(
      () => readSprinkleRefConfig(undefined, dir),
      /local project config overrides are disabled: sprinkleref\.categories\.main\.file/,
    );
  } finally {
    if (old === undefined) delete process.env.VBR_DISALLOW_LOCAL_OVERRIDES;
    else process.env.VBR_DISALLOW_LOCAL_OVERRIDES = old;
  }
});

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-project-config-"));
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function withEnv<T>(name: string, value: string, run: () => Promise<T>) {
  const old = process.env[name];
  process.env[name] = value;
  try {
    return await run();
  } finally {
    if (old === undefined) delete process.env[name];
    else process.env[name] = old;
  }
}
