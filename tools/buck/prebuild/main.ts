#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { printSkip } from "../../lib/errors";
import { getFlagBool, getFlagStr } from "../../lib/cli.ts";
import { providerNameForImporter } from "../../lib/providers.ts";
import { readCompositeGraph } from "../../lib/graph-view.ts";
import { providersForLabels } from "../../lib/labels.ts";
import { autoFixGlue } from "./repair.ts";
import { collectDiagnostics, logList, mtimeSafe } from "./report.ts";
import { listInputs, listOutputs } from "./scan.ts";

type Mode = "ci" | "local";
const mode: Mode = process.env.CI === "true" ? "ci" : "local";
const skewMs = Number(process.env.PREBUILD_GUARD_SKEW_MS || "5000");
const flagVerbose = getFlagBool("verbose") || process.env.PREBUILD_GUARD_VERBOSE === "1";
const jsonOut = getFlagBool("json");
const flagStrict = getFlagBool("strict");

function getVerboseLimit(): number {
  const limStr = getFlagStr("verbose-limit", "");
  if (limStr) {
    const n = Number(limStr);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const envN = Number(process.env.PREBUILD_GUARD_LIST_LIMIT || "10");
  return Number.isFinite(envN) && envN > 0 ? envN : 10;
}

const verboseLimit = getVerboseLimit();

export async function run(): Promise<void> {
  // PR-3: Friendly local dev-override notice (no behavior change)
  if (mode === "local") {
    const goOv = (process.env.NIX_GO_DEV_OVERRIDE_JSON || "").trim();
    const cppOv = (process.env.NIX_CPP_DEV_OVERRIDE_JSON || "").trim();
    if (goOv || cppOv) {
      const vars = [
        goOv ? "NIX_GO_DEV_OVERRIDE_JSON" : "",
        cppOv ? "NIX_CPP_DEV_OVERRIDE_JSON" : "",
      ]
        .filter(Boolean)
        .join(", ");
      console.warn(
        `[prebuild] dev overrides active (${vars}) — local derivation hashes will differ; clear with: node tools/dev/clear-overrides.ts`,
      );
    }
  }

  const inputs = await listInputs();
  const outputs = listOutputs();

  const outPresence: string[] = [];
  for (const o of outputs) {
    if (!fs.existsSync(o)) outPresence.push(o);
  }
  // Node-specific presence: if any pnpm-lock.yaml exists, require TARGETS.node.auto
  try {
    let lockfiles: string[] = [];
    try {
      const { stdout } = await $`git ls-files '**/pnpm-lock.yaml'`;
      lockfiles = String(stdout || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {}
    if (lockfiles.length > 0) {
      const nodeAuto = "third_party/providers/TARGETS.node.auto";
      if (!fs.existsSync(nodeAuto)) outPresence.push(nodeAuto);
    }
  } catch {}
  // If any provider autos exist, require nix_attr_map.bzl to be present (needed for provider index).
  try {
    const provDir = "third_party/providers";
    const autosPresent =
      fs.existsSync(provDir) && fs.readdirSync(provDir).some((f) => /^TARGETS.*\.auto$/.test(f));
    const nixMap = path.join(provDir, "nix_attr_map.bzl");
    if (autosPresent && !fs.existsSync(nixMap)) {
      outPresence.push(nixMap);
    }
  } catch {}
  const needFixPresence = outPresence.length > 0;

  // Go providers/index no longer enforced; local patches are handled via target srcs

  const presentOutputs = outputs.filter((o) => fs.existsSync(o));
  let needFixFreshness = false;
  if (presentOutputs.length > 0) {
    const newestInput = Math.max(
      0,
      ...inputs.map((f) => mtimeSafe(f)).filter((n): n is number => n != null),
    );
    const oldestOutput = Math.min(
      ...presentOutputs.map((f) => mtimeSafe(f)).filter((n): n is number => n != null),
    );
    if (Number.isFinite(newestInput) && Number.isFinite(oldestOutput)) {
      if (newestInput > oldestOutput + skewMs) {
        needFixFreshness = true;
        if (mode === "ci") {
          console.error(
            `ERROR: glue is stale. Newest input is newer than outputs by ${Math.round(
              (newestInput - oldestOutput) / 1000,
            )}s`,
          );
          const sortedInputs = [...inputs].sort((a, b) => mtimeSafe(b)! - mtimeSafe(a)!);
          const sortedOutputs = [...presentOutputs].sort((a, b) => mtimeSafe(a)! - mtimeSafe(b)!);
          logList("newer input", sortedInputs, Number(process.env.PREBUILD_GUARD_LIST_LIMIT || 5));
          logList(
            "older output",
            sortedOutputs,
            Number(process.env.PREBUILD_GUARD_LIST_LIMIT || 5),
          );
        }
      }
    }
  }

  // Explicit: ensure node-lock-index.json is not older than graph.json
  try {
    const graphPath = path.join("tools", "buck", "graph.json");
    const sidecarPath = path.join("tools", "buck", "node-lock-index.json");
    if (fs.existsSync(graphPath) && fs.existsSync(sidecarPath)) {
      const mg = mtimeSafe(graphPath) || 0;
      const ms = mtimeSafe(sidecarPath) || 0;
      if (mg > ms) {
        needFixFreshness = true;
        if (mode === "ci") {
          console.error(
            `ERROR: node-lock-index.json is stale by ${Math.round((mg - ms) / 1000)}s versus graph.json`,
          );
        }
      }
    }
  } catch {}

  const needFix = needFixPresence || needFixFreshness;

  // Node importer presence check: ensure TARGETS.node.auto contains an entry
  // for every importer present in any pnpm-lock.yaml. This runs after generic
  // presence/freshness checks so diagnostics can include importer-specific detail.
  const missingNodeProviders: Array<{ lockfile: string; importer: string; provider: string }> = [];
  try {
    // Discover lockfiles tracked in VCS
    let lockfiles: string[] = [];
    try {
      const { stdout } = await $`git ls-files '**/pnpm-lock.yaml'`;
      lockfiles = String(stdout || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {}
    if (lockfiles.length) {
      const targetsNodeAuto = "third_party/providers/TARGETS.node.auto";
      const targetsNodeText = fs.existsSync(targetsNodeAuto)
        ? await fsp.readFile(targetsNodeAuto, "utf8").catch(() => "")
        : "";
      // Lazy-load YAML parser only if needed
      const haveYaml = await (async () => {
        try {
          await import("yaml");
          return true;
        } catch {
          return false;
        }
      })();
      for (const lf of lockfiles) {
        // If YAML is unavailable, we cannot enumerate importers; rely on generic
        // freshness/presence checks in that case.
        if (!haveYaml) break;
        try {
          const mod = await import("yaml");
          const YAML: any = (mod as any).default || mod;
          const doc = YAML.parse(await fsp.readFile(lf, "utf8")) as {
            importers?: Record<string, unknown>;
          };
          const importers = Object.keys(doc?.importers || {});
          for (const imp of importers) {
            // Normalize importer the same way as syncNodeProviders: map '.' to the
            // directory containing the lockfile. This keeps presence checks and
            // generated provider names in sync and avoids false-missing reports.
            const importerLabel = imp === "." ? require("node:path").dirname(lf) || "." : imp;
            const prov = providerNameForImporter(lf, importerLabel);
            const needle = `node_importer_deps(name="${prov}", lockfile="${lf}", importer="${importerLabel}"`;
            if (!targetsNodeText.includes(needle)) {
              missingNodeProviders.push({ lockfile: lf, importer: importerLabel, provider: prov });
            }
          }
        } catch {}
      }
    }
  } catch {}

  // Provider coverage validation (PR-4):
  // - For every node with lockfile:/nixpkg: labels, assert a provider exists
  //   and that MODULE_PROVIDERS maps the node to that provider.
  type CoverageMiss =
    | { kind: "provider"; node: string; provider: string }
    | { kind: "mapping"; node: string; provider: string };
  const coverageMissing: CoverageMiss[] = [];
  try {
    // Parse auto_map.bzl if present
    const autoMapPath = path.join("third_party", "providers", "auto_map.bzl");
    let autoMapText = "";
    try {
      autoMapText = await fsp.readFile(autoMapPath, "utf8");
    } catch {}
    function parseModuleProviders(txt: string): Record<string, string[]> {
      const out: Record<string, string[]> = {};
      if (!txt) return out;
      // Very small parser for:
      // MODULE_PROVIDERS = {
      //   "//pkg:rule": [
      //     "//third_party/providers:<name>",
      //   ],
      // }
      const lines = txt.split(/\r?\n/);
      let curKey: string | null = null;
      for (const raw of lines) {
        const line = raw.trim();
        if (!curKey) {
          const m = line.match(/^"([^"]+)":\s*\[$/);
          if (m) {
            curKey = m[1];
            if (!out[curKey]) out[curKey] = [];
          }
        } else {
          if (line === "],") {
            curKey = null;
            continue;
          }
          const m = line.match(/^"([^"]+)",$/);
          if (m) {
            out[curKey].push(m[1]);
          }
        }
      }
      return out;
    }
    const moduleProviders = parseModuleProviders(autoMapText);

    // Composite graph provides nodes and optional provider index sidecar
    const comp = await readCompositeGraph();
    const providerIndex = comp.providerIndex || {};

    // Helper: cheap existence checks per provider family
    const targetsNodeAutoPath = path.join("third_party", "providers", "TARGETS.node.auto");
    const targetsNodeText = fs.existsSync(targetsNodeAutoPath)
      ? await fsp.readFile(targetsNodeAutoPath, "utf8").catch(() => "")
      : "";
    function providerExists(fq: string): boolean {
      if (!fq || !fq.startsWith("//third_party/providers:")) return false;
      if (providerIndex[fq]) return true;
      const tail = fq.split(":")[1] || "";
      if (tail.startsWith("lf_")) {
        return targetsNodeText.includes(`name="${tail}"`);
      }
      if (tail.startsWith("nix_")) {
        const stamp = path.join("third_party", "providers", "stamps", `${tail}.stamp`);
        return fs.existsSync(stamp);
      }
      return false;
    }

    for (const n of comp.nodes) {
      const nodeName = n?.name || "";
      if (!nodeName) continue;
      const expected = providersForLabels(n.labels);
      if (expected.length === 0) continue;
      for (const prov of expected) {
        if (!providerExists(prov)) {
          coverageMissing.push({ kind: "provider", node: nodeName, provider: prov });
          continue;
        }
        const mapped = (moduleProviders[nodeName] || []).includes(prov);
        if (!mapped) {
          coverageMissing.push({ kind: "mapping", node: nodeName, provider: prov });
        }
      }
    }
  } catch {}

  if (flagVerbose) {
    const sortedInputs = [...inputs].sort((a, b) => (mtimeSafe(b) || 0) - (mtimeSafe(a) || 0));
    const sortedOutputs = [...presentOutputs].sort(
      (a, b) => (mtimeSafe(a) || 0) - (mtimeSafe(b) || 0),
    );
    logList("newer input", sortedInputs, verboseLimit);
    logList("older output", sortedOutputs, verboseLimit);
    for (const o of outPresence.slice(0, verboseLimit)) {
      console.error(`missing output: ${o}`);
    }
  }
  if (jsonOut) {
    const diag = collectDiagnostics(inputs, presentOutputs, outPresence, verboseLimit);
    (diag as any).missingNodeProviders = missingNodeProviders;
    (diag as any).coverageMissing = coverageMissing;
    console.log(JSON.stringify(diag));
    return;
  }

  // Enforce: any importer with go.mod must also have go.sum (fail with guidance)
  const goMissingSum: string[] = [];
  for (const base of ["apps", "libs"]) {
    try {
      for (const d of fs.readdirSync(base, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const dir = require("node:path").join(base, d.name);
        const gm = fs.existsSync(require("node:path").join(dir, "go.mod"));
        const gs = fs.existsSync(require("node:path").join(dir, "go.sum"));
        if (gm && !gs) goMissingSum.push(dir);
      }
    } catch {}
  }
  if (goMissingSum.length) {
    for (const imp of goMissingSum) {
      console.error(
        `ERROR: ${imp} has go.mod but no go.sum. Run 'tools/dev/install-deps.ts' to auto-tidy or add --skip-go-tidy to bypass`,
      );
    }
    process.exit(1);
  }

  // Additional presence guard (PR 3): ensure gomod2nix.toml exists when go.mod present
  // We only warn locally; CI will fail on missing outputs anyway once glue runs.
  const missingGomod: string[] = [];
  for (const base of ["apps", "libs"]) {
    try {
      for (const d of fs.readdirSync(base, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const dir = require("node:path").join(base, d.name);
        const gm = require("node:fs").existsSync(require("node:path").join(dir, "go.mod"));
        const gt = require("node:fs").existsSync(require("node:path").join(dir, "gomod2nix.toml"));
        if (gm && !gt) missingGomod.push(require("node:path").join(dir, "gomod2nix.toml"));
      }
    } catch {}
  }
  if (missingGomod.length && mode === "ci") {
    for (const m of missingGomod) {
      console.error(
        `ERROR: missing ${m} — run tools/dev/install-deps.ts to generate gomod2nix.toml`,
      );
    }
    process.exit(1);
  }

  // If importer-specific providers are missing, fail in CI or attempt auto-fix locally
  if (missingNodeProviders.length) {
    if (mode === "ci") {
      for (const m of missingNodeProviders) {
        console.error(
          `ERROR: missing Node importer provider: lockfile=${m.lockfile} importer=${m.importer} provider=${m.provider}`,
        );
      }
      process.exit(1);
    }
    if (process.env.PREBUILD_GUARD_NO_FIX === "1") {
      printSkip(
        "missing-required-files",
        "node importer providers missing: " +
          missingNodeProviders
            .map((m) => `${m.provider} for ${m.lockfile}#${m.importer}`)
            .join(", "),
      );
      return;
    }
    try {
      await autoFixGlue();
    } catch (e) {
      console.error("ERROR: auto-fix (sync providers) failed:", e);
      process.exit(1);
    }
  }

  // Provider coverage failures: CI errors, local warnings unless --strict
  if (coverageMissing.length > 0) {
    const header =
      mode === "ci" || flagStrict
        ? "ERROR: provider coverage check failed"
        : "WARN: provider coverage check";
    console.error(header);
    for (const miss of coverageMissing) {
      if (miss.kind === "provider") {
        console.error(
          `  missing provider for node=${miss.node} expected=${miss.provider} (run sync/generate providers)`,
        );
      } else {
        console.error(
          `  missing mapping in MODULE_PROVIDERS for node=${miss.node} provider=${miss.provider} (run gen-auto-map)`,
        );
      }
    }
    if (mode === "ci" || flagStrict) {
      process.exit(1);
    }
  }

  if (!needFix && !missingNodeProviders.length) return;

  if (mode === "ci") {
    for (const o of outPresence) {
      console.error(
        `ERROR: ${o} missing — run glue generation in this order: export-graph → sync-providers → gen-auto-map`,
      );
    }
    process.exit(1);
  }

  if (process.env.PREBUILD_GUARD_NO_FIX === "1") {
    // In no-fix mode, exit 0 locally after printing diagnostics
    if (outPresence.length) {
      printSkip("stale-glue", outPresence.join(", "));
    }
    return;
  }
  try {
    await autoFixGlue();
  } catch (e) {
    console.error("ERROR: auto-fix failed:", e);
    process.exit(1);
  }
}
