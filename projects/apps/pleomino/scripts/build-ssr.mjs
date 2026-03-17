import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensureDistServiceWorkerPrecache } from "./service-worker-precache.mjs";

const contractsPaths = JSON.parse(
  execSync(
    "zx-wrapper ../../../build-tools/tools/dev/sync-module-contracts.ts --cwd . --print-json 1",
    {
      encoding: "utf8",
    },
  ),
);
const wasmManifestPath = String(contractsPaths.wasmManifestPath || "").trim();
const tsManifestPath = String(contractsPaths.tsManifestPath || "").trim();
if (!wasmManifestPath || !tsManifestPath) {
  throw new Error("module contracts sync did not return wasm/ts manifest paths");
}

cpSync(wasmManifestPath, "src/wasm-modules.manifest.json");
cpSync(tsManifestPath, "src/ts-modules.manifest.json");
execSync(
  `zx-wrapper ../../../build-tools/tools/dev/ensure-wasm-contract-assets.ts --cwd . --wasm-manifest ${JSON.stringify(wasmManifestPath)}`,
  { stdio: "inherit" },
);

execSync("vite build --outDir dist/client", { stdio: "inherit" });
ensureDistServiceWorkerPrecache(path.join("dist", "client"));
execSync("vite build --ssr src/entry-server.ts --outDir dist/server", { stdio: "inherit" });
execSync("tsc -p tsconfig.server.json", { stdio: "inherit" });

const wasmManifest = JSON.parse(readFileSync(wasmManifestPath, "utf8"));
for (const entry of wasmManifest.modules || []) {
  const sourcePath = String(entry.sourcePath || "");
  const serverDest = String(entry.runtimeDestinations?.server || "");
  if (!sourcePath || !serverDest) continue;
  const outAbs = path.join("dist", serverDest);
  mkdirSync(path.dirname(outAbs), { recursive: true });
  cpSync(sourcePath, outAbs);
}

cpSync(wasmManifestPath, "dist/server/wasm-modules.manifest.json");
cpSync(tsManifestPath, "dist/server/ts-modules.manifest.json");
