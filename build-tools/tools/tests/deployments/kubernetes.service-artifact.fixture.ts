#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";

export async function writeServiceArtifact(root: string, content: string): Promise<string> {
  await fsp.mkdir(path.join(root, "dist", "src"), { recursive: true });
  await fsp.writeFile(path.join(root, "dist", "src", "index.js"), content, "utf8");
  await fsp.writeFile(path.join(root, "package.json"), '{"type":"module"}\n', "utf8");
  await fsp.writeFile(
    path.join(root, "runtime-contract.json"),
    JSON.stringify(
      {
        schemaVersion: "node-service-runtime@1",
        serviceName: "api",
        entrypoint: "src/index.js",
        productionCommand: ["node", "dist/src/index.js"],
        health: { path: "/healthz", port: 3000 },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  const identity = `node-service:${crypto.createHash("sha256").update(content).digest("hex")}`;
  await fsp.writeFile(
    path.join(root, "artifact-identity.json"),
    JSON.stringify(
      { schemaVersion: "node-service-artifact-identity@1", kind: "node-service", identity },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return identity;
}

export async function writeImageDigest(filePath: string): Promise<string> {
  const digest = `sha256:${"a".repeat(64)}`;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${digest}\n`, "utf8");
  return `image-digest:${digest}`;
}
