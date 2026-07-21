#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildArtifactEnvironment,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import { runBoundedArtifactCommand } from "../../lib/artifact-command-runner";
import { artifactNixPolicyArgs } from "../../lib/artifact-nix-policy";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";

async function command(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = await runBoundedArtifactCommand({
    command,
    args,
    env,
    timeoutMs: 600_000,
  });
  return { code: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

async function nixSystem(nix: string, env: NodeJS.ProcessEnv): Promise<string> {
  const result = await command(nix, ["config", "show", "--json"], env);
  assert.equal(result.code, 0, result.stderr);
  return String(JSON.parse(result.stdout)?.system?.value || "");
}

function fetchDerivation(opts: { name: string; url: string; outputHash?: string }): string {
  const hash = opts.outputHash
    ? `outputHashMode = "flat"; outputHashAlgo = "sha256"; outputHash = ${JSON.stringify(opts.outputHash)};`
    : "";
  return `builtins.derivation {
    name = ${JSON.stringify(opts.name)};
    system = "builtin";
    builder = "builtin:fetchurl";
    url = ${JSON.stringify(opts.url)};
    ${hash}
  }`;
}

function ordinaryDerivation(opts: {
  name: string;
  system: string;
  builder: string;
  args: string[];
}): string {
  const args = opts.args.map((arg) => JSON.stringify(arg)).join(" ");
  return `builtins.derivation {
    name = ${JSON.stringify(opts.name)};
    system = ${JSON.stringify(opts.system)};
    builder = ${JSON.stringify(opts.builder)};
    args = [${args}];
  }`;
}

async function buildExpression(nix: string, env: NodeJS.ProcessEnv, expression: string) {
  return await command(
    nix,
    [
      "build",
      ...artifactNixPolicyArgs(),
      // This private harness admits the already-resolved store tool paths into the
      // expression. The derivations themselves remain sandboxed with no host paths.
      "--impure",
      "--no-link",
      "--print-out-paths",
      "--expr",
      expression,
    ],
    env,
  );
}

test("effective artifact policy blocks host files and network and enforces fixed hashes", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "artifact-sandbox-"));
  let server: http.Server | undefined;
  try {
    const env = buildArtifactEnvironment({
      baseEnv: withoutArtifactEnvironmentInfluence(process.env),
      mode: "ci",
      stateRoot: path.join(tmp, "environment"),
      workspaceRoot: path.resolve(process.cwd()),
    });
    const nix = ensureNixStoreToolPathSync("nix", env);
    const system = await nixSystem(nix, env);
    assert.ok(system);
    const toolsRoot = String(env.VBR_ARTIFACT_TOOLS_ROOT || "");
    const secret = path.join(tmp, "host-canary");
    await fsp.writeFile(secret, "undeclared-host-value\n");

    server = http.createServer((_request, response) => response.end("fixed-output-value\n"));
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const hostRead = await buildExpression(
      nix,
      env,
      ordinaryDerivation({
        name: "vbr-host-file-canary",
        system,
        builder: path.join(toolsRoot, "bin", "cat"),
        args: [secret],
      }),
    );
    assert.notEqual(hostRead.code, 0, "ordinary derivation read an undeclared host file");
    assert.doesNotMatch(hostRead.stderr, /must be a fixed-output or impure derivation/);
    assert.match(hostRead.stderr, /No such file|Operation not permitted|Permission denied/i);

    const network = await buildExpression(
      nix,
      env,
      ordinaryDerivation({
        name: "vbr-network-canary",
        system,
        builder: path.join(toolsRoot, "bin", "bash"),
        args: [
          "--noprofile",
          "--norc",
          "-c",
          `exec 3<>/dev/tcp/127.0.0.1/${address.port}; printf 'GET /ordinary HTTP/1.0\\r\\n\\r\\n' >&3; cat <&3 > \"$out\"`,
        ],
      }),
    );
    assert.notEqual(network.code, 0, "ordinary derivation reached the host network");
    assert.doesNotMatch(network.stderr, /must be a fixed-output or impure derivation/);
    assert.match(
      network.stderr,
      /Operation not permitted|Permission denied|Network is unreachable/i,
    );

    const content = "fixed-output-value\n";
    const correctHash = `sha256-${crypto.createHash("sha256").update(content).digest("base64")}`;
    const fixedUrl = `http://127.0.0.1:${address.port}/fixed-output`;
    const fixed = (hash: string) =>
      fetchDerivation({
        name: "vbr-fixed-output-canary",
        url: fixedUrl,
        outputHash: hash,
      });
    const correct = await buildExpression(nix, env, fixed(correctHash));
    assert.equal(correct.code, 0, correct.stderr);
    assert.notEqual(
      (await buildExpression(nix, env, fixed(`sha256-${Buffer.alloc(32).toString("base64")}`)))
        .code,
      0,
    );
  } finally {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
