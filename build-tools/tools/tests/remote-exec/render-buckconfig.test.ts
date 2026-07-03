#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  fingerprintConfig,
  renderRemoteBuckconfig,
  validateRenderedBuckConfigKeys,
  type RemoteBuckConfigInput,
} from "../../remote-exec/render-buckconfig";
import {
  renderRemoteTestActivationConfigText,
  writeRemoteTestActivationConfig,
} from "../../remote-exec/remote-test-activation";

async function tempDir(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function input(overrides: Partial<RemoteBuckConfigInput> = {}) {
  const root = await tempDir("remote-buckconfig");
  return {
    artifactDir: path.join(root, "buck-out/tmp/remote-exec/run-1"),
    engineAddress: "grpc://re.example.invalid:8980",
    casAddress: "grpc://cas.example.invalid:8980",
    actionCacheAddress: "grpc://cache.example.invalid:8980",
    instanceName: "viberoots/test",
    auth: { mode: "headers", httpHeaders: ["authorization: ${VBR_RE_TOKEN}"] },
    targetSystem: "x86_64-linux",
    targetProfile: "linux-x86_64-default",
    fallbackPolicy: "strict-remote",
    eventLogReportDir: path.join(root, "buck-out/tmp/remote-exec/reports"),
    ...overrides,
  } satisfies RemoteBuckConfigInput;
}

test("renders a fake remote config and stable fingerprint without credentials", async () => {
  const result = await renderRemoteBuckconfig(await input());

  assert.match(result.configText, /\[buck2_re_client\]/);
  assert.match(result.configText, /http_headers = \["authorization: \$\{VBR_RE_TOKEN\}"\]/);
  assert.match(
    result.configText,
    /execution_platforms = toolchains\/\/:remote_execution_platforms/,
  );
  assert.match(result.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.fingerprint, fingerprintConfig(result.configText));
  assert.equal(await fs.readFile(result.configPath, "utf8"), result.configText);
  assert.equal(result.summary, `fingerprint=${result.fingerprint}`);
  assert.doesNotMatch(
    result.summary,
    /target|fallback|eventLogReportDir|VBR_RE_TOKEN|Bearer|api_key/i,
  );
});

test("renders mTLS paths and rejects inline PEM material", async () => {
  const mtls = await renderRemoteBuckconfig(
    await input({
      auth: {
        mode: "mtls",
        caCerts: "${VBR_RE_CA_CERTS}",
        clientCert: "/var/run/re/client.crt",
        clientKey: "./secrets/client.key",
      },
      fallbackPolicy: "hybrid",
    }),
  );

  assert.match(mtls.configText, /\[buck2_re_client\.tls\]/);
  await assert.rejects(
    renderRemoteBuckconfig(
      await input({
        auth: {
          mode: "mtls",
          caCerts: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
          clientCert: "/tmp/client.crt",
          clientKey: "/tmp/client.key",
        },
      }),
    ),
    /inline PEM/,
  );
});

test("rejects missing required fields, bad fallback policy, paths, and inline secrets", async () => {
  await assert.rejects(
    renderRemoteBuckconfig(await input({ instanceName: "" })),
    /invalid instanceName/,
  );
  await assert.rejects(
    renderRemoteBuckconfig(await input({ fallbackPolicy: "remote" as any })),
    /unsupported fallbackPolicy/,
  );
  await assert.rejects(
    renderRemoteBuckconfig(await input({ fallbackPolicy: undefined as any })),
    /unsupported fallbackPolicy/,
  );
  await assert.rejects(
    renderRemoteBuckconfig(await input({ artifactDir: process.cwd() })),
    /repository root/,
  );
  await assert.rejects(
    renderRemoteBuckconfig(await input({ artifactDir: path.join(os.tmpdir(), "remote-run") })),
    /artifact\/config directories/,
  );
  await assert.rejects(
    renderRemoteBuckconfig(
      await input({
        auth: { mode: "headers", httpHeaders: ["authorization: Bearer abcdefghijklmnop"] },
      }),
    ),
    /environment references/,
  );
  await assert.rejects(
    renderRemoteBuckconfig(
      await input({ auth: { mode: "headers", httpHeaders: ["x-api-key: abcdefghijklmnop"] } }),
    ),
    /environment references/,
  );
  await assert.rejects(
    renderRemoteBuckconfig(
      await input({ auth: { mode: "headers", httpHeaders: ["x-token: short-token"] } }),
    ),
    /environment references/,
  );
});

test("validates endpoints, platform inputs, event directory, and rendered key surface", async () => {
  await assert.rejects(
    renderRemoteBuckconfig(await input({ engineAddress: "https://re.example.invalid" })),
    /invalid engineAddress/,
  );
  await assert.rejects(
    renderRemoteBuckconfig(await input({ targetSystem: "arm64-linux" })),
    /invalid targetSystem/,
  );
  await assert.rejects(
    renderRemoteBuckconfig(await input({ targetProfile: "../default" })),
    /invalid targetProfile/,
  );
  await assert.rejects(
    renderRemoteBuckconfig(await input({ eventLogReportDir: "." })),
    /artifact\/config directories/,
  );
  assert.throws(
    () => validateRenderedBuckConfigKeys("[buck2_re_client]\nunsupported = true\n"),
    /unsupported Buck config key/,
  );
});

test("generated config stays unused by local verify and Jenkins defaults", async () => {
  const buckconfig = await fs.readFile(".buckconfig", "utf8");

  assert.doesNotMatch(buckconfig, /\[buck2_re_client(?:[.\]]|\])/);
  assert.doesNotMatch(buckconfig, /VBR_REMOTE_BUCK_CONFIG/);
});

test("generated activation config contains only profile names and toolchain labels", async () => {
  const root = await tempDir("remote-activation");
  const result = await writeRemoteTestActivationConfig({
    artifactDir: path.join(root, "artifacts", "activation"),
    passName: "shared",
    targetProfile: "linux-x86_64-default",
  });

  assert.match(result.configText, /\[build\]/);
  assert.match(result.configText, /repo_toolchains\/\/:remote_execution_platforms/);
  assert.match(result.configText, /\[test\]/);
  assert.match(result.configText, /viberoots_remote_profile = linux-x86_64-default/);
  assert.equal(await fs.readFile(result.configPath, "utf8"), result.configText);
  assert.doesNotMatch(
    result.configText,
    /grpc:\/\/|grpcs:\/\/|authorization|api[_-]?key|token|secret|password/i,
  );
});

test("generated activation config rejects endpoints and credential-shaped labels", () => {
  assert.throws(
    () =>
      renderRemoteTestActivationConfigText({
        artifactDir: "/tmp/artifacts",
        passName: "shared",
        targetProfile: "grpc://re.example.invalid:8980",
      }),
    /invalid activation targetProfile/,
  );
  assert.throws(
    () =>
      renderRemoteTestActivationConfigText({
        artifactDir: "/tmp/artifacts",
        executionPlatforms: "authorization: ${VBR_RE_TOKEN}",
        passName: "shared",
        targetProfile: "linux-x86_64-default",
      }),
    /invalid activation executionPlatforms label/,
  );
});

test("generated activation config reaches zx_test executor analysis", async () => {
  const root = await tempDir("remote-activation-analysis");
  const result = await writeRemoteTestActivationConfig({
    artifactDir: path.join(root, "artifacts", "activation"),
    passName: "shared",
    targetProfile: "linux-x86_64-default",
  });

  const local = await $({
    stdio: "pipe",
  })`buck2 audit providers --target-platforms prelude//platforms:default viberoots//:remote_exec_verify_remote_policy`.nothrow();
  assert.equal(local.exitCode, 0, local.stderr);
  assert.match(local.stdout, /default_executor=None/);

  const activated = await $({
    stdio: "pipe",
  })`buck2 audit providers --config-file ${result.configPath} --target-platforms prelude//platforms:default viberoots//:remote_exec_verify_remote_policy`.nothrow();

  assert.equal(activated.exitCode, 0, activated.stderr);
  assert.match(activated.stdout, /default_executor=CommandExecutorConfig/);
  assert.match(activated.stdout, /executor: RemoteEnabled/);
  assert.match(activated.stdout, /executor: Remote\(/);
  assert.match(activated.stdout, /RemoteExecutorUseCase[\s\S]*data: "buck2-test"/);
  assert.match(activated.stdout, /"viberoots_remote_profile": "linux-x86_64-default"/);
  assert.match(activated.stdout, /"resource_class": "default"/);
  assert.match(activated.stdout, /executor_overrides=\{\s*"listing": CommandExecutorConfig/);
  assert.match(activated.stdout, /re_action_key: Some\(\s*"viberoots=remote-profile-probe"/);
});
