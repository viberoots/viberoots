#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createVercelNextArtifact, VERCEL_NEXT_ARTIFACT_SCHEMA } from "../../vercel/next-artifact";
import { mktemp } from "../lib/test-helpers";

function declaredVercelEnv(extra: string[] = []): string[] {
  return [
    ...Object.keys(process.env).filter((name) => name === "VERCEL" || name.startsWith("VERCEL_")),
    ...extra,
  ].sort();
}

async function writeConfig(appDir: string, envNames = declaredVercelEnv()): Promise<string> {
  const configPath = path.join(appDir, "vercel.project.json");
  await fsp.writeFile(
    configPath,
    JSON.stringify(
      {
        schemaVersion: VERCEL_NEXT_ARTIFACT_SCHEMA,
        projectName: "demo-next",
        framework: "nextjs",
        runtime: { nodeVersion: "22.x", buildEnv: envNames, runtimeEnv: [] },
      },
      null,
      2,
    ) + "\n",
  );
  return configPath;
}

async function writeNextDist(appDir: string): Promise<string> {
  const dist = path.join(appDir, "dist");
  await fsp.mkdir(path.join(dist, "server"), { recursive: true });
  await fsp.mkdir(path.join(dist, "client", ".next", "static", "chunks"), { recursive: true });
  await fsp.mkdir(path.join(dist, "client", "public"), { recursive: true });
  await fsp.writeFile(path.join(dist, "server", "index.js"), "console.log('server');\n");
  await fsp.writeFile(path.join(dist, "client", ".next", "BUILD_ID"), "build-id\n");
  await fsp.writeFile(path.join(dist, "client", ".next", "static", "chunks", "app.js"), "app\n");
  await fsp.writeFile(path.join(dist, "client", "public", "favicon.ico"), "ico\n");
  return dist;
}

async function createArtifact(root: string): Promise<string> {
  const appDir = path.join(root, "app");
  await fsp.mkdir(appDir, { recursive: true });
  const distDir = await writeNextDist(appDir);
  const configPath = await writeConfig(appDir);
  return await createVercelNextArtifact({
    appDir,
    distDir,
    configPath,
    outputDir: path.join(root, "out", ".vercel", "output"),
    identityPath: path.join(root, "out", "artifact-identity.json"),
  });
}

test("Vercel Next artifact identity is stable for identical finalized output bytes", async () => {
  const tmp = await mktemp("vercel-next-identity-");
  const first = await createArtifact(path.join(tmp, "first"));
  const second = await createArtifact(path.join(tmp, "second"));
  assert.equal(first, second);
  const identity = JSON.parse(
    await fsp.readFile(path.join(tmp, "first", "out", "artifact-identity.json"), "utf8"),
  );
  assert.equal(identity.identity, first);
  await fsp.access(path.join(tmp, "first", "out", ".vercel", "output", "config.json"));
  await fsp.access(
    path.join(
      tmp,
      "first",
      "out",
      ".vercel",
      "output",
      "functions",
      "render.func",
      "server",
      "index.js",
    ),
  );
  await fsp.access(
    path.join(
      tmp,
      "first",
      "out",
      ".vercel",
      "output",
      "static",
      "_next",
      "static",
      "chunks",
      "app.js",
    ),
  );
  await fsp.access(path.join(tmp, "first", "out", ".vercel", "output", "viberoots.json"));
  const staleMarker = ["buck", "nix.json"].join("");
  await assert.rejects(
    () => fsp.access(path.join(tmp, "first", "out", ".vercel", "output", staleMarker)),
    /ENOENT/,
  );
});

test("Vercel Next artifact rejects ambient local and environment state", async () => {
  const tmp = await mktemp("vercel-next-fail-closed-");
  const appDir = path.join(tmp, "app");
  await fsp.mkdir(path.join(appDir, ".vercel"), { recursive: true });
  const distDir = await writeNextDist(appDir);
  const configPath = await writeConfig(appDir);
  await assert.rejects(
    () =>
      createVercelNextArtifact({
        appDir,
        distDir,
        configPath,
        outputDir: path.join(tmp, "out"),
        identityPath: path.join(tmp, "identity.json"),
      }),
    /ambient \.vercel state/,
  );

  await fsp.rm(path.join(appDir, ".vercel"), { recursive: true, force: true });
  process.env.VERCEL_TEST_UNDECLARED_VIBEROOTS = "1";
  try {
    await assert.rejects(
      () =>
        createVercelNextArtifact({
          appDir,
          distDir,
          configPath,
          outputDir: path.join(tmp, "out"),
          identityPath: path.join(tmp, "identity.json"),
        }),
      /undeclared Vercel environment variables/,
    );
  } finally {
    delete process.env.VERCEL_TEST_UNDECLARED_VIBEROOTS;
  }
});
