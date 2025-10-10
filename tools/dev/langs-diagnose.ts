#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";

type Capabilities = Record<string, boolean>;
type LangEntry = {
  id: string;
  displayName?: string;
  requiredPaths?: string[];
  optionalPaths?: string[];
  kinds?: string[];
  capabilities?: Capabilities;
  templatesDir?: string;
};
type Manifest = { enabled?: string[]; languages?: LangEntry[] } | LangEntry[];

type DiagnoseOutput = {
  enabled: string[];
  disabled: Array<{ id: string; missingPaths: string[] }>;
  adapters: string[];
  plannerPlugins: string[];
  stages: string[];
};

function argvFlag(name: string): boolean {
  return (global as any).argv?.[name] === "" || Boolean((global as any).argv?.[name]);
}

function argvValue(name: string): string {
  const v = (global as any).argv?.[name];
  return typeof v === "string" ? v : String(v || "");
}

function pathToFileUrlLike(p: string): string {
  const abs = path.resolve(p);
  const pref = abs.startsWith("/") ? "file://" : "file:///";
  return pref + abs;
}

async function readManifest(): Promise<{
  enabled: Set<string>;
  caps: Map<string, Capabilities>;
  langs: Map<string, LangEntry>;
}> {
  const p = path.resolve("tools/nix/langs.json");
  const enabled = new Set<string>();
  const caps = new Map<string, Capabilities>();
  const langs = new Map<string, LangEntry>();
  try {
    const txt = await fs.readFile(p, "utf8");
    const raw = JSON.parse(txt) as Manifest;
    if (Array.isArray(raw)) {
      for (const l of raw) {
        if (l && typeof (l as any).id === "string") {
          const id = String((l as any).id);
          langs.set(id, l as any);
          if ((l as any).capabilities) caps.set(id, ((l as any).capabilities || {}) as any);
        }
      }
    } else if (raw && typeof raw === "object") {
      for (const id of raw.enabled || []) enabled.add(String(id));
      for (const l of raw.languages || []) {
        if (l && typeof (l as any).id === "string") {
          const id = String((l as any).id);
          langs.set(id, l as any);
          if ((l as any).capabilities) caps.set(id, ((l as any).capabilities || {}) as any);
        }
      }
    }
  } catch {
    // no manifest is OK; remain empty
  }
  return { enabled, caps, langs };
}

async function detectEnabledAndMissing(
  langs: Map<string, LangEntry>,
  enabledPref: Set<string>,
  filterId: string,
): Promise<{
  enabled: string[];
  disabled: Array<{ id: string; missingPaths: string[] }>;
}> {
  const enabled: string[] = [];
  const disabled: Array<{ id: string; missingPaths: string[] }> = [];
  const prefer = (id: string) => (enabledPref.size === 0 ? true : enabledPref.has(id));
  const existsAbs = async (rel: string) => fs.pathExists(path.resolve(rel));
  const ids = Array.from(langs.keys()).sort();
  for (const id of ids) {
    if (filterId && id !== filterId) continue;
    const e = langs.get(id) || { id };
    const req = Array.isArray(e.requiredPaths) ? e.requiredPaths : [];
    const missing: string[] = [];
    for (const r of req) {
      if (!(await existsAbs(r))) missing.push(r);
    }
    if (prefer(id) && missing.length === 0) enabled.push(id);
    else disabled.push({ id, missingPaths: missing });
  }
  return { enabled, disabled };
}

async function detectExporterAdapters(): Promise<string[]> {
  const adapters: string[] = [];
  // Rely on exporter contract loader if available
  const contractPath = path.resolve("tools/buck/exporter/lang/contract.ts");
  if (await fs.pathExists(contractPath)) {
    try {
      const mod = (await import(pathToFileUrlLike(contractPath))) as any;
      const load = mod.loadPresentAdapters as (() => Promise<any[]>) | undefined;
      if (typeof load === "function") {
        const loaded = await load();
        for (const a of loaded || [])
          if (a && typeof a.name === "string") adapters.push(String(a.name));
      }
    } catch {
      // ignore
    }
  }
  return Array.from(new Set(adapters)).sort();
}

async function detectPlannerPlugins(
  manifestLangs: Map<string, LangEntry>,
  filterId: string,
): Promise<string[]> {
  const dir = path.resolve("tools/nix/planner");
  const present: string[] = [];
  if (await fs.pathExists(dir)) {
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    for (const f of files) {
      if (!f.endsWith(".nix")) continue;
      const id = f.replace(/\.nix$/i, "");
      if (filterId && id !== filterId) continue;
      present.push(id);
    }
  }
  const ids = new Set(present);
  // Include any manifest-listed languages that have a plugin file
  for (const id of manifestLangs.keys()) {
    if (filterId && id !== filterId) continue;
    const p = path.resolve("tools/nix/planner", `${id}.nix`);
    if (await fs.pathExists(p)) ids.add(id);
  }
  return Array.from(ids).sort();
}

async function computeStages(
  enabled: string[],
  caps: Map<string, Capabilities>,
  filterId: string,
): Promise<string[]> {
  const stages: string[] = [];
  const has = (id: string) => enabled.includes(id);
  const cap = (id: string, k: string) => Boolean((caps.get(id) || ({} as any))[k]);
  // sync-providers-go
  if ((!filterId && has("go")) || (filterId === "go" && has("go"))) {
    if (
      caps.size === 0 ||
      cap("go", "patching") ||
      !(caps.get("go") && caps.get("go")!.patching === false)
    ) {
      stages.push("sync-providers-go");
    }
  }
  // sync-providers-node — require lockfile presence for usefulness
  const nodeEligible =
    ((!filterId && has("node")) || (filterId === "node" && has("node"))) &&
    (caps.size === 0 ||
      cap("node", "patching") ||
      !(caps.get("node") && caps.get("node")!.patching === false));
  if (nodeEligible) {
    let anyLock = false;
    try {
      // quick walk to detect any pnpm-lock.yaml under repo
      const walk = async (d: string) => {
        const entries = await fs.readdir(d, { withFileTypes: true });
        for (const e of entries) {
          if (
            e.name === "node_modules" ||
            e.name === ".git" ||
            e.name === "buck-out" ||
            e.name === ".direnv"
          )
            continue;
          const p = path.join(d, e.name);
          if (e.isDirectory()) await walk(p);
          else if (e.isFile() && e.name === "pnpm-lock.yaml") {
            anyLock = true;
            return;
          }
          if (anyLock) return;
        }
      };
      await walk(process.cwd());
    } catch {}
    if (anyLock) stages.push("sync-providers-node");
  }
  // other stages are general; always list common sequence
  stages.push("export-graph", "gen-auto-map", "prebuild-guard", "buck-test");
  return stages;
}

function printHuman(out: DiagnoseOutput, filterId: string) {
  const sep = () => console.log("");
  console.log("Languages:");
  console.log("  enabled:", out.enabled.join(", ") || "(none)");
  if (out.disabled.length) {
    for (const d of out.disabled) {
      if (filterId && d.id !== filterId) continue;
      const miss = d.missingPaths.length ? ` (missing: ${d.missingPaths.join(", ")})` : "";
      console.log(`  disabled: ${d.id}${miss}`);
    }
  }
  sep();
  console.log("Exporter adapters:");
  console.log("  ", out.adapters.join(", ") || "(none)");
  sep();
  console.log("Planner plugins:");
  console.log("  ", out.plannerPlugins.join(", ") || "(none)");
  sep();
  console.log("CI stages (would run):");
  for (const s of out.stages) console.log("  -", s);

  // Extra note for C++: list patched attrs if present
  if (!filterId || filterId === "cpp") {
    try {
      const autoMap = path.resolve("third_party/providers/auto_map.bzl");
      if (fs.existsSync(autoMap)) {
        const txt = fs.readFileSync(autoMap, "utf8");
        const re = new RegExp('"//third_party/providers:nix_pkgs_([a-z0-9_]+)"', "gi");
        const set = new Set<string>();
        let m: RegExpExecArray | null;
        while ((m = re.exec(txt))) set.add(m[1]);
        if (set.size) {
          sep();
          console.log("Patched C++ nixpkgs providers detected:");
          console.log("  ", Array.from(set).sort().join(", "));
        }
      }
    } catch {}
  }
}

async function main() {
  const asJson = argvFlag("json");
  const filterId = argvValue("lang");

  const { enabled: enabledPref, caps, langs } = await readManifest();
  const { enabled, disabled } = await detectEnabledAndMissing(langs, enabledPref, filterId);
  const adapters = await detectExporterAdapters();
  const plannerPlugins = await detectPlannerPlugins(langs, filterId);
  const stages = await computeStages(enabled, caps, filterId);

  const out: DiagnoseOutput = {
    enabled: enabled.sort(),
    disabled: disabled.sort((a, b) => a.id.localeCompare(b.id)),
    adapters,
    plannerPlugins,
    stages,
  };

  if (asJson) console.log(JSON.stringify(out, null, 2));
  else printHuman(out, filterId);
}

// PR 29: Wrap main() with error policy that treats known skips as exit 0
import { runMain } from "../lib/cli-wrap";
runMain(main);
