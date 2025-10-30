#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import { printSkip } from "../../lib/errors";
import { providerNameForImporter } from "../../lib/providers.ts";
import { autoFixGlue } from "./repair.ts";
import { collectDiagnostics, logList, mtimeSafe } from "./report.ts";
import { hasPatchesOrLocks, listInputs, listOutputs, missingProviderAutos } from "./scan.ts";

type Mode = "ci" | "local";
const mode: Mode = process.env.CI === "true" ? "ci" : "local";
const skewMs = Number(process.env.PREBUILD_GUARD_SKEW_MS || "5000");
const argv = process.argv.slice(2);
const flagVerbose = argv.includes("--verbose") || process.env.PREBUILD_GUARD_VERBOSE === "1";
const jsonOut = argv.includes("--json");

function getVerboseLimit(): number {
  const idx = argv.indexOf("--verbose-limit");
  if (idx >= 0 && argv[idx + 1]) {
    const n = Number(argv[idx + 1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const envN = Number(process.env.PREBUILD_GUARD_LIST_LIMIT || "10");
  return Number.isFinite(envN) && envN > 0 ? envN : 10;
}

const verboseLimit = getVerboseLimit();

export async function run(): Promise<void> {
  const inputs = await listInputs();
  const outputs = listOutputs();

  const outPresence: string[] = [];
  for (const o of outputs) {
    if (!fs.existsSync(o)) outPresence.push(o);
  }
  if (hasPatchesOrLocks(inputs) && missingProviderAutos()) {
    outPresence.push("third_party/providers/TARGETS*.auto");
  }
  // PR 10: If any provider autos exist, require nix_attr_map.bzl to be present
  try {
    const provDir = "third_party/providers";
    const hasProvAutos =
      fs.existsSync(provDir) && fs.readdirSync(provDir).some((f) => /^TARGETS.*\.auto$/.test(f));
    if (hasProvAutos && !fs.existsSync("third_party/providers/nix_attr_map.bzl")) {
      outPresence.push("third_party/providers/nix_attr_map.bzl");
    }
  } catch {}
  const needFixPresence = outPresence.length > 0;

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
        ? await fs.readFile(targetsNodeAuto, "utf8").catch(() => "")
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
          const doc = YAML.parse(await fs.readFile(lf, "utf8")) as {
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
    console.log(JSON.stringify(diag));
    return;
  }

  // Additional presence guard (PR 3): ensure gomod2nix.toml exists when go.mod present
  // We only warn locally; CI will fail on missing outputs anyway once glue runs.
  const missingGomod: string[] = [];
  for (const base of ["apps", "libs"]) {
    try {
      for (const d of fs.readdirSync(base, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const dir = require("node:path").join(base, d.name);
        const gm = require("fs").existsSync(require("node:path").join(dir, "go.mod"));
        const gt = require("fs").existsSync(require("node:path").join(dir, "gomod2nix.toml"));
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
        "node-importer-providers-missing",
        missingNodeProviders.map((m) => `${m.provider} for ${m.lockfile}#${m.importer}`).join(", "),
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
