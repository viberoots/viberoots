#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInScratchTemp } from "../lib/test-helpers";
import { killBuckDaemonsForRepo } from "../lib/test-helpers/buck-kill";
import { timeDiagnosticAsync } from "../lib/test-helpers/timing";
import { exactDescendantCommandPids, processTreeRows } from "../lib/process-tree";
import {
  buildTauriOutPath,
  inspectTauriDerivationIdentity,
  makeTauriCompositionConsumer,
} from "./rust.tauri-consumer-fixture";

process.env.TEST_NEED_DEV_ENV = "1";
const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
const target = "//projects/apps/tauri-composition-app:desktop";
const evidencePrefix = "VIBEROOTS_TAURI_COMPOSITION_EVIDENCE ";
const failurePrefix = "VIBEROOTS_TAURI_COMPOSITION_FAILURE ";

async function findFile(root: string, basename: string): Promise<string> {
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of await fsp.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile() && entry.name === basename) return file;
    }
  }
  throw new Error(`missing ${basename} under ${root}`);
}

async function findFileWithSuffix(root: string, suffix: string): Promise<string> {
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of await fsp.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile() && entry.name.endsWith(suffix)) return file;
    }
  }
  throw new Error(`missing *${suffix} under ${root}`);
}

test(
  "isolated Tauri composition builds, packages, and executes every typed provider",
  { timeout: 2_700_000 },
  async () => {
    await runInScratchTemp("tauri-composition-runtime", async (tmp, $) => {
      const fixture = await makeTauriCompositionConsumer(tmp, sourceRoot, $);
      const { consumer, artifactEnv } = fixture;
      try {
        await timeDiagnosticAsync("tauri composition derivation identity", async () =>
          inspectTauriDerivationIdentity(consumer, artifactEnv(), target, $),
        );
        const outPath = await timeDiagnosticAsync("tauri composition artifact build", async () =>
          buildTauriOutPath(consumer, artifactEnv(), target, $),
        );
        await timeDiagnosticAsync("tauri composition nested verify", async () => {
          await $({
            cwd: consumer,
            env: artifactEnv(),
            stdio: "inherit",
          })`v --seed-mode=never ${target}`;
        });
        const manifestPath = path.join(outPath, "share/viberoots-tauri/artifact-manifest.json");
        const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
        assert.equal(manifest.schema, "viberoots.tauri-artifact.v1");
        assert.deepEqual(manifest.appWindows, ["main"]);
        assert.equal(manifest.withGlobalTauri, false);
        assert.deepEqual(manifest.appCommands, [
          "report_composition_evidence",
          "report_composition_failure",
        ]);
        assert.deepEqual(manifest.capabilities, [
          {
            source: "default.json",
            identifier: "default",
            permissions: [
              "core:default",
              "allow-report-composition-evidence",
              "allow-report-composition-failure",
            ],
            windows: ["main"],
          },
        ]);
        assert.deepEqual(manifest.resources, [
          { source: "resource.txt", destination: "assets/resource.txt" },
        ]);
        assert.deepEqual(manifest.sidecars, [
          {
            label: "//projects/apps/tauri-composition-app:sidecar",
            destination: "bin/composition-sidecar",
          },
        ]);
        const appExecutable = String(manifest.appExecutable || "");
        await fsp.access(appExecutable);
        const packagedFrontend = String(manifest.frontend || "");
        await fsp.access(packagedFrontend);
        const packagedIndex = await findFile(packagedFrontend, "index.html");
        const packagedScript = await findFileWithSuffix(packagedFrontend, ".js");
        assert.match(await fsp.readFile(packagedIndex, "utf8"), /<script[^>]+type="module"/);
        const frontend = await fsp.readFile(packagedScript, "utf8");
        assert.doesNotMatch(frontend, /@tauri-apps\/api|window\.__TAURI__/);
        for (const wasm of ["rust.wasm", "cpp.wasm", "go.wasm"]) {
          await fsp.access(await findFile(packagedFrontend, wasm));
        }
        for (const expected of [
          "rust.wasm",
          "cpp.wasm",
          "go.wasm",
          "report_composition_evidence",
        ]) {
          assert.match(frontend, new RegExp(expected.replace(".", "\\.")));
        }

        const child = spawn("p", [target], {
          cwd: consumer,
          env: artifactEnv(),
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let runtimeOutput = "";
        child.stdout!.on("data", (chunk) => {
          runtimeOutput += String(chunk);
          process.stdout.write(chunk);
        });
        child.stderr!.on("data", (chunk) => {
          runtimeOutput += String(chunk);
          process.stderr.write(chunk);
        });
        let exited = false;
        child.once("exit", () => {
          exited = true;
        });
        let exactPids: number[] = [];
        let evidence: Record<string, unknown> | null = null;
        let runtimeFailure: string | undefined;
        const deadline = Date.now() + 180_000;
        while (!exited && Date.now() < deadline) {
          exactPids = exactDescendantCommandPids(
            await processTreeRows(),
            child.pid!,
            appExecutable,
          );
          const runtimeLines = runtimeOutput.split(/\r?\n/);
          const evidenceLine = runtimeLines.find((line) => line.startsWith(evidencePrefix));
          runtimeFailure = runtimeLines.find((line) => line.startsWith(failurePrefix));
          evidence = evidenceLine ? JSON.parse(evidenceLine.slice(evidencePrefix.length)) : null;
          if (runtimeFailure || (exactPids.length > 0 && evidence?.complete === true)) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        const exitedBeforeEvidence = exited;
        try {
          process.kill(-child.pid!, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (!exited) {
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
        const cleanupDeadline = Date.now() + 10_000;
        let groupAlive = true;
        while (groupAlive && Date.now() < cleanupDeadline) {
          groupAlive = (await processTreeRows()).some((row) => row.pgid === child.pid);
          if (groupAlive) await new Promise((resolve) => setTimeout(resolve, 250));
        }
        assert.equal(
          exitedBeforeEvidence,
          false,
          "shared p exited before composition evidence completed",
        );
        assert.ok(exactPids.length > 0, "shared p did not launch the packaged executable");
        assert.equal(
          runtimeFailure,
          undefined,
          runtimeFailure || "unexpected frontend failure evidence",
        );
        assert.deepEqual(evidence, {
          backend: 42,
          bridge: 42,
          rustWasm: 42,
          cppWasm: 42,
          goWasm: 42,
          complete: true,
        });
        assert.equal(groupAlive, false, "composition p process group survived cleanup");
      } finally {
        await killBuckDaemonsForRepo(tmp, $);
      }
    });
  },
);
