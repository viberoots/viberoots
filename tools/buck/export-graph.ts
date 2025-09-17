#!/usr/bin/env zx-wrapper
/**
 * tools/buck/export-graph.ts — Configured Buck graph exporter with Go module labels
 * Generated file is not committed. See build-system-design.md (Exporting the Buck Graph (ZX)).
 */
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";

type Node = {
  name: string;
  rule_type: string;
  labels?: string[];
  srcs?: string[];
};

const out = (argv.out as string) || "tools/buck/graph.json";
const scope = (argv.scope as string) || ""; // e.g., "label:go" to limit local runs
const simulate = (argv.simulate as string) || ""; // path to simulated nodes JSON (tests)
const maxParallel = Number(argv["max-parallel"] || 4);
const cacheDir = (argv["cache-dir"] as string) || "tools/buck/.export-cache";
const metricsOut = (argv["metrics-out"] as string) || "";

const attrList = [
  "name",
  "rule_type",
  "srcs",
  "deps",
  "labels",
  "args",
  "env",
  "main",
  "main_class",
  "includes",
  "defines",
  "cflags",
  "ldflags",
];

function isGoNode(n: Node): boolean {
  if ((n.rule_type || "").startsWith("go_")) return true;
  const labs = n.labels || [];
  return labs.includes("lang:go");
}

type Metrics = {
  totalBatches: number;
  cacheHits: number;
  cacheMisses: number;
  durationMs: number;
  tupleKeys: string[];
};

let gMetrics: Metrics = {
  totalBatches: 0,
  cacheHits: 0,
  cacheMisses: 0,
  durationMs: 0,
  tupleKeys: [],
};

async function exportConfiguredGraph(): Promise<Node[]> {
  let nodes: Node[];
  if (simulate) {
    const txt = await fs.readFile(simulate, "utf8");
    nodes = JSON.parse(txt) as Node[];
  } else {
    const query = scope
      ? `attrfilter(labels, ${scope}, deps(//..., 1, exec_deps()))`
      : `deps(//..., 1, exec_deps())`;
    const flags = attrList.flatMap((a) => ["--output-attribute", a]);
    const { stdout } = await $`buck2 cquery ${query} --json ${flags}`;
    const obj = JSON.parse(String(stdout)) as Record<string, any>;
    nodes = Object.values(obj) as any[];
  }
  const enriched = await attachGoModuleLabels(nodes);
  const normalized = enriched.map((n) => ({
    ...n,
    labels: Array.from(new Set(n.labels || [])).sort(),
  }));
  return normalized.sort((a, b) => a.name.localeCompare(b.name));
}

async function writeAtomicJSON(file: string, data: any) {
  const txt = JSON.stringify(data, null, 2);
  const tmp = file + ".tmp";
  await fs.outputFile(tmp, txt, "utf8");
  await fs.move(tmp, file, { overwrite: true });
}

// -------------------- Phase 3 core: authoritative module labeler --------------------

type GoPkg = {
  ImportPath?: string;
  Dir?: string;
  Deps?: string[];
  Imports?: string[];
  ForTest?: string | null;
  Module?: {
    Path?: string;
    Version?: string;
    Replace?: { Path?: string; Version?: string } | null;
  } | null;
};

type Tuple = {
  goos: string;
  goarch: string;
  cgo: string;
  tagsKey: string; // sorted, joined
  goflagsKey: string; // normalized GOFLAGS
  toolchain: string; // short hash or "unknown"
};

function tupleKey(t: Tuple): string {
  return [t.goos, t.goarch, t.cgo, t.tagsKey, t.goflagsKey, t.toolchain].join("|");
}

function parseTagsFromLabels(labels: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const l of labels || []) {
    if (l.startsWith("gotags:")) {
      const rest = l.slice("gotags:".length);
      for (const t of rest.split(",")) {
        const v = t.trim().toLowerCase();
        if (v) out.add(v);
      }
    }
  }
  return Array.from(out).sort();
}

function parseTagsFromGOFLAGS(envGOFLAGS: string | undefined): string[] {
  const s = envGOFLAGS || "";
  if (!s) return [];
  const out = new Set<string>();
  // Accept forms: -tags=a,b -tags=\"a b\" etc.
  // Simple extraction: split by spaces, find -tags=*
  for (const part of s.split(/\s+/)) {
    if (part.startsWith("-tags=")) {
      const val = part.slice("-tags=".length).replace(/^\"|\"$/g, "");
      for (const tok of val.split(/[ ,]+/)) {
        const v = tok.trim().toLowerCase();
        if (v) out.add(v);
      }
    }
  }
  return Array.from(out).sort();
}

function normalizeGOFLAGS(s: string | undefined): string {
  const v = (s || "").trim();
  if (!v) return "";
  // Collapse multiple spaces; sort repeated -tags values internally
  const parts = v.split(/\s+/);
  const norm: string[] = [];
  for (const p of parts) {
    if (p.startsWith("-tags=")) {
      const val = p.slice("-tags=".length).replace(/^\"|\"$/g, "");
      const tags = val
        .split(/[ ,]+/)
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
        .sort();
      norm.push(`-tags=${tags.join(",")}`);
    } else {
      norm.push(p);
    }
  }
  return norm.join(" ");
}

async function gatherToolchainIdentity(): Promise<string> {
  try {
    const { stdout: gorootOut } = await $({ stdio: "pipe" })`go env GOROOT`;
    const { stdout: goversionOut } = await $({ stdio: "pipe" })`go version`;
    const goroot = String(gorootOut || "").trim();
    const goversion = String(goversionOut || "").trim();
    const obj = {
      goroot,
      goversion,
      goos: process.env.GOOS || (os.platform() === "darwin" ? "darwin" : os.platform()),
      goarch:
        process.env.GOARCH ||
        (process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : process.arch),
      cgo: process.env.CGO_ENABLED || "1",
    } as const;
    return require("node:crypto")
      .createHash("sha256")
      .update(JSON.stringify(obj))
      .digest("hex")
      .slice(0, 12);
  } catch {
    return "unknown";
  }
}

async function deriveTupleForNode(n: Node): Promise<Tuple> {
  const goos = (
    process.env.GOOS || (os.platform() === "darwin" ? "darwin" : os.platform())
  ).toString();
  const goarch =
    process.env.GOARCH ||
    (process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : process.arch);
  const cgo = process.env.CGO_ENABLED || "1";
  const tagsFromLabels = parseTagsFromLabels(n.labels);
  const tagsFromFlags = parseTagsFromGOFLAGS(process.env.GOFLAGS);
  const mergedTags = Array.from(new Set([...tagsFromLabels, ...tagsFromFlags])).sort();
  const goflagsKey = normalizeGOFLAGS(process.env.GOFLAGS);
  const toolchain = await gatherToolchainIdentity();
  return { goos, goarch, cgo, tagsKey: mergedTags.join(","), goflagsKey, toolchain };
}

function packageDirFromTargetName(name: string): string {
  // Expect //path/to/pkg:rule
  const m = name.match(/^\/\/(.+):[^:]+$/);
  return m ? m[1] : ".";
}

function dirsForTarget(n: Node): string[] {
  const srcs = Array.isArray((n as any).srcs) ? ((n as any).srcs as string[]) : [];
  const pkgDir = packageDirFromTargetName(n.name);
  const dirs = new Set<string>();
  if (srcs.length === 0) {
    dirs.add(pkgDir);
  }
  for (const s of srcs) {
    const d = path.dirname(s);
    // If src is relative (no path separators), use package dir
    if (d === ".") dirs.add(pkgDir);
    else dirs.add(d);
  }
  return Array.from(dirs);
}

async function findModuleRootForDirs(dirs: string[]): Promise<string | null> {
  for (const d of dirs) {
    const mod = path.join(process.cwd(), d, "go.mod");
    if (await fs.pathExists(mod)) return d;
    const parent = path.join(process.cwd(), d, "..", "go.mod");
    if (await fs.pathExists(parent)) return path.join(d, "..");
  }
  return null;
}

async function buildBatches(
  nodes: Node[],
): Promise<Array<{ tuple: Tuple; members: Node[]; roots: string[]; cwd: string }>> {
  const groups = new Map<
    string,
    { tuple: Tuple; members: Node[]; roots: Set<string>; cwd: string }
  >();
  for (const n of nodes) {
    if (!isGoNode(n)) continue;
    const t = await deriveTupleForNode(n);
    const dirs = dirsForTarget(n);
    const modRoot = await findModuleRootForDirs(dirs);
    if (!modRoot) continue; // skip if we can't find a module
    const key = `${tupleKey(t)}|${modRoot}`;
    const entry = groups.get(key) || {
      tuple: t,
      members: [],
      roots: new Set<string>(),
      cwd: modRoot,
    };
    entry.members.push(n);
    for (const d of dirs) entry.roots.add(d);
    groups.set(key, entry);
  }
  const list = Array.from(groups.values()).map((g) => ({
    tuple: g.tuple,
    members: g.members,
    roots: Array.from(g.roots),
    cwd: g.cwd,
  }));
  // record tuple keys for metrics
  gMetrics.tupleKeys = Array.from(new Set(list.map((x) => tupleKey(x.tuple)))).sort();
  return list;
}

function toHashInput(tuple: Tuple, roots: string[], modRootAbs: string): any {
  return {
    tuple,
    modRoot: modRootAbs,
    roots: Array.from(new Set(roots)).sort(),
  };
}

async function sha256OfFile(p: string): Promise<string> {
  try {
    const buf = await fs.readFile(p);
    return require("node:crypto").createHash("sha256").update(buf).digest("hex");
  } catch {
    return "";
  }
}

async function ensureDir(p: string) {
  await fs.mkdirp(p);
}

async function runGoList(tuple: Tuple, roots: string[], cwd: string): Promise<GoPkg[]> {
  if (!roots.length) return [];
  const env = {
    ...process.env,
    GOOS: tuple.goos,
    GOARCH: tuple.goarch,
    CGO_ENABLED: tuple.cgo,
  } as any;
  // Restrict to packages under the detected module root cwd
  const norm = Array.from(new Set(roots.map((r) => path.relative(cwd, r)))).map((rel) =>
    rel === "" ? "." : rel.startsWith(".") ? rel : `./${rel}`,
  );
  const args = ["list", "-deps", "-json", "-test", ...norm];
  // Caching
  const modRootAbs = path.resolve(cwd);
  const gomod = path.join(modRootAbs, "go.mod");
  const gosum = path.join(modRootAbs, "go.sum");
  const gomod2nix = path.resolve("gomod2nix.toml");
  const input = toHashInput(tuple, roots, modRootAbs);
  const lockHash =
    (await sha256OfFile(gomod2nix)) || (await sha256OfFile(gomod)) + (await sha256OfFile(gosum));
  const keyObj = { input, lockHash };
  const key = require("node:crypto")
    .createHash("sha256")
    .update(JSON.stringify(keyObj))
    .digest("hex");
  const cachePath = path.join(cacheDir, `${key}.json`);
  await ensureDir(cacheDir);
  if (await fs.pathExists(cachePath)) {
    gMetrics.cacheHits++;
    const txt = await fs.readFile(cachePath, "utf8");
    return parseGoListStream(txt);
  }
  gMetrics.cacheMisses++;
  const { stdout } = await $({ env, stdio: "pipe", cwd })`go ${args}`;
  const raw = String(stdout);
  await fs.outputFile(cachePath, raw, "utf8");
  return parseGoListStream(raw);
}

function parseGoListStream(s: string): GoPkg[] {
  // Parse a concatenated JSON object stream from `go list -json`
  const out: GoPkg[] = [];
  let buf = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    buf += ch;
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth === 0 && buf.trim()) {
      try {
        const obj = JSON.parse(buf);
        out.push(obj as GoPkg);
      } catch {
        // Ignore parse errors for chunks that aren't full JSON objects
      }
      buf = "";
    }
  }
  return out;
}

function buildPkgIndexes(pkgs: GoPkg[]) {
  const byImport = new Map<string, GoPkg>();
  const byDir = new Map<string, GoPkg>();
  const testByDir = new Map<string, GoPkg[]>();
  function normalizeDir(d: string): string {
    // macOS sometimes reports go package Dir under /private/var while cwd is /var
    if (d.startsWith("/private/var/")) return d.slice("/private".length);
    return d;
  }
  for (const p of pkgs) {
    if (p.ImportPath) byImport.set(p.ImportPath, p);
    if (p.Dir) {
      const dir = normalizeDir(p.Dir);
      const rel = path.relative(process.cwd(), dir);
      byDir.set(rel, p);
      if ((p.ImportPath || "").endsWith(".test") || (p.ForTest && p.ForTest !== "")) {
        const arr = testByDir.get(rel) || [];
        arr.push(p);
        testByDir.set(rel, arr);
      }
    }
  }
  return { byImport, byDir, testByDir };
}

function reachableImports(from: GoPkg, byImport: Map<string, GoPkg>): Set<string> {
  const seen = new Set<string>();
  const stack: string[] = [];
  const edges = new Set<string>([...(from.Deps || []), ...(from.Imports || [])]);
  for (const e of edges) stack.push(e);
  while (stack.length) {
    const ip = stack.pop()!;
    if (seen.has(ip)) continue;
    seen.add(ip);
    const p = byImport.get(ip);
    if (!p) continue;
    const next = new Set<string>([...(p.Deps || []), ...(p.Imports || [])]);
    for (const n of next) if (!seen.has(n)) stack.push(n);
  }
  return seen;
}

function effectiveModuleKey(p: GoPkg): string | null {
  const m = p.Module;
  if (!m) return null; // stdlib
  const pathEff = (m.Replace && m.Replace.Path) || m.Path || "";
  const verEff = (m.Replace && m.Replace.Version) || m.Version || "";
  if (!pathEff) return null;
  const key = `${pathEff}@${verEff || "unknown"}`.toLowerCase();
  return key;
}

async function attachGoModuleLabels(nodes: Node[]): Promise<Node[]> {
  // Fast path: if no go rules present, return normalized labels
  const anyGo = nodes.some((n) => isGoNode(n));
  if (!anyGo) return nodes.map((n) => ({ ...n, labels: Array.from(new Set(n.labels || [])) }));

  // Simulated mode: derive labels without network access via simple import/require parsing
  const forceAuth = String(process.env.FORCE_AUTHORITATIVE || "") === "1";
  if (simulate && !forceAuth) {
    function parseImportsFromFile(absPath: string): string[] {
      try {
        const txt = fs.readFileSync(absPath, "utf8");
        const out = new Set<string>();
        // match import "path" and import alias "path" and multi-line blocks
        const singleRe = /\bimport\s+(?:[a-zA-Z_][\w]*)?\s*"([^"]+)"/g;
        let m: RegExpExecArray | null;
        while ((m = singleRe.exec(txt))) out.add(m[1]);
        const blockRe = /\bimport\s*\(([^)]+)\)/g;
        while ((m = blockRe.exec(txt))) {
          const inner = m[1];
          const re2 = /"([^"]+)"/g;
          let m2: RegExpExecArray | null;
          while ((m2 = re2.exec(inner))) out.add(m2[1]);
        }
        return Array.from(out);
      } catch {
        return [];
      }
    }
    function modulePathForImport(imp: string): string {
      const parts = imp.split("/");
      if (parts.length >= 3 && (parts[0].includes(".") || parts[0] === "github.com")) {
        return parts.slice(0, 3).join("/");
      }
      if (parts.length >= 2) return parts.slice(0, 2).join("/");
      return imp;
    }
    function findGoMod(dir: string): string | null {
      let cur = path.join(process.cwd(), dir);
      for (let i = 0; i < 4; i++) {
        const p = path.join(cur, "go.mod");
        if (fs.existsSync(p)) return p;
        const next = path.join(cur, "..");
        if (path.resolve(next) === path.resolve(cur)) break;
        cur = next;
      }
      return null;
    }
    function versionForModule(modPath: string, goModPath: string | null): string {
      if (!goModPath) return "unknown";
      try {
        const txt = fs.readFileSync(goModPath, "utf8");
        const esc = modPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Prefer replace directive's right-hand version when present
        // Forms:
        //   replace <mod> => <mod2> vX.Y.Z
        //   replace <mod> vA.B.C => <mod2> vX.Y.Z
        const rep = new RegExp(
          `^\\s*replace\\s+${esc}(?:\\s+[^\\s]+)?\\s*=>\\s+[^\\s]+\\s+([^\\s]+)`,
          "m",
        );
        const mr = rep.exec(txt);
        if (mr && mr[1]) return mr[1];

        // Direct require line
        const reqLine = new RegExp(`^\\s*require\\s+${esc}\\s+([^\\s)]+)`, "m");
        const m = reqLine.exec(txt);
        if (m && m[1]) return m[1];

        // handle require ( ... ) blocks
        const block = /require\s*\(([^)]+)\)/ms.exec(txt);
        if (block) {
          const inner = block[1];
          const re = new RegExp(`^\\s*${esc}\\s+([^\\s]+)`, "m");
          const m2 = re.exec(inner);
          if (m2 && m2[1]) return m2[1];
        }
      } catch {}
      return "unknown";
    }

    const outNodes: Node[] = [];
    for (const n of nodes) {
      if (!isGoNode(n)) {
        outNodes.push(n);
        continue;
      }
      const keep = (n.labels || []).filter((l) => !l.startsWith("module:"));
      const dirs = dirsForTarget(n);
      const moduleKeys = new Set<string>();
      const srcs = (n as any).srcs || [];
      for (const d of dirs) {
        const goMod = findGoMod(d);
        for (const s of srcs as string[]) {
          const abs = path.join(process.cwd(), d, s);
          if (!abs.endsWith(".go")) continue;
          const imports = parseImportsFromFile(abs);
          for (const imp of imports) {
            if (!imp.includes(".")) continue; // skip stdlib
            const modPath = modulePathForImport(imp);
            const ver = versionForModule(modPath, goMod);
            moduleKeys.add(`module:${modPath}@${ver}`.toLowerCase());
          }
        }
      }
      outNodes.push({ ...n, labels: [...keep, ...Array.from(moduleKeys)] });
    }
    // Record tupleKeys for metrics even in simulate mode
    try {
      const tuples = await Promise.all(
        outNodes.filter((n) => isGoNode(n)).map((n) => deriveTupleForNode(n)),
      );
      gMetrics.tupleKeys = Array.from(new Set(tuples.map((t) => tupleKey(t)))).sort();
    } catch {}
    return outNodes;
  }

  // Authoritative mode via go list
  const batches = await buildBatches(nodes);
  gMetrics.totalBatches = batches.length;
  const results: Array<{ members: Node[]; labelsByTarget: Map<string, Set<string>> }> = [];

  // Simple parallel limiter
  let i = 0;
  const startedAt = Date.now();
  const work = new Array(Math.max(1, Math.min(maxParallel, batches.length)))
    .fill(0)
    .map(async () => {
      while (i < batches.length) {
        const idx = i++;
        const b = batches[idx];
        const pkgs = await runGoList(b.tuple, b.roots, path.join(process.cwd(), b.cwd));
        const { byImport, byDir, testByDir } = buildPkgIndexes(pkgs);
        const labelsByTarget = new Map<string, Set<string>>();
        for (const n of b.members) {
          const dirs = dirsForTarget(n);
          const moduleKeys = new Set<string>();
          for (const d of dirs) {
            const rootPkg = byDir.get(d);
            if (!rootPkg) continue;
            // Seed with root and, for test targets, the synthetic test package(s)
            const isTestTarget = ((n as any).srcs || []).some((s: string) => /_test\.go$/.test(s));
            const seeds: GoPkg[] = [rootPkg];
            if (isTestTarget) {
              for (const tpkg of testByDir.get(d) || []) seeds.push(tpkg);
            }
            const include = new Set<string>();
            for (const seed of seeds) {
              if (!seed.ImportPath) continue;
              include.add(seed.ImportPath);
              const reach = reachableImports(seed, byImport);
              for (const ip of reach) include.add(ip);
            }
            for (const ip of include) {
              const p = byImport.get(ip);
              if (!p) continue;
              const key = effectiveModuleKey(p);
              if (key) moduleKeys.add(`module:${key}`);
            }
          }
          labelsByTarget.set(n.name, moduleKeys);
        }
        results.push({ members: b.members, labelsByTarget });
      }
    });
  await Promise.all(work);
  gMetrics.durationMs = Date.now() - startedAt;

  const labelsLookup = new Map<string, Set<string>>();
  for (const r of results) {
    for (const [t, set] of r.labelsByTarget) {
      const cur = labelsLookup.get(t) || new Set<string>();
      for (const x of set) cur.add(x);
      labelsLookup.set(t, cur);
    }
  }

  return nodes.map((n) => {
    if (!isGoNode(n)) return n;
    const keep = (n.labels || []).filter((l) => !l.startsWith("module:"));
    const add = Array.from(labelsLookup.get(n.name) || new Set<string>());
    return { ...n, labels: [...keep, ...add] };
  });
}

async function main() {
  const nodes = await exportConfiguredGraph();
  await writeAtomicJSON(out, nodes);
  console.log(`wrote ${out}`);
  if (metricsOut) {
    try {
      await fs.outputFile(metricsOut, JSON.stringify(gMetrics, null, 2) + "\n", "utf8");
      console.log(`wrote metrics ${metricsOut}`);
    } catch {}
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
