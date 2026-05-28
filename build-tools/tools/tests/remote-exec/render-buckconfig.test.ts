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
  const [buckconfig, jenkins] = await Promise.all([
    fs.readFile(".buckconfig", "utf8"),
    fs.readFile("Jenkinsfile", "utf8"),
  ]);

  assert.doesNotMatch(buckconfig, /\[buck2_re_client(?:[.\]]|\])/);
  assert.doesNotMatch(buckconfig, /VBR_REMOTE_BUCK_CONFIG/);
  assert.doesNotMatch(jenkins, /VBR_REMOTE_BUCK_CONFIG\s*=/);
});
