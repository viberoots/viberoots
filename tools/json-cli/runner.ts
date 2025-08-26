import * as fsp from "node:fs/promises";
import path from "node:path";

type CliOpts = {
  help: boolean;
  version: boolean;
  list: boolean;
  where: string | null;
  inFile: string | null;
  dryRun: boolean;
  toolRef: string | null;
};

type RootConfig = {
  defaultPackage?: string;
  ignore?: string[];
  globs?: string[];
  excludeGlobs?: string[];
  env?: Record<string, string>;
};

type ToolSpec = {
  tool?: { name?: string };
  command?: { package?: string };
};

export async function main(argv: string[]): Promise<number | void> {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }
  if (opts.version) {
    console.log(await readVersion());
    return 0;
  }

  const rootDir = await resolveRoot();
  const rootCfg = await readRootConfig(rootDir);

  if (opts.list) {
    const idx = await buildIndex(rootDir, rootCfg);
    for (const [fq, p] of idx) {
      console.log(`${fq}\t${p}`);
    }
    return 0;
  }

  if (opts.where) {
    const idx = await buildIndex(rootDir, rootCfg);
    const fq = resolveToolRef(opts.where, rootCfg);
    const hit = idx.get(fq);
    if (!hit) {
      console.error(`json-cli: tool not found: ${fq}`);
      return 78;
    }
    console.log(hit);
    return 0;
  }

  if (!opts.toolRef) {
    printHelp("missing <toolRef>");
    return 2;
  }

  // Execution and dry-run are not implemented in PR1.
  console.error("json-cli: execution not implemented yet (PR1 skeleton)");
  return 78;
}

function parseArgs(argv: string[]): CliOpts {
  const out: CliOpts = {
    help: false,
    version: false,
    list: false,
    where: null,
    inFile: null,
    dryRun: false,
    toolRef: null,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--version" || a === "-v") out.version = true;
    else if (a === "--list") out.list = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--in") out.inFile = argv[++i] ?? null;
    else if (a === "--where") out.where = argv[++i] ?? null;
    else if (a.startsWith("-")) {
      // unknown flag; keep for future but ignore
    } else {
      rest.push(a);
    }
  }
  out.toolRef = rest[0] ?? null;
  return out;
}

function printHelp(error?: string) {
  if (error) console.error(`json-cli: ${error}`);
  console.log(`Usage: json-cli <toolRef> [--in file.json] [--dry-run] [--list] [--where <toolRef>]

Flags:
  -h, --help        Show help
  -v, --version     Show version
      --list        List discovered tools (FQName -> path)
      --where REF   Print the path to the tool spec for REF
      --in FILE     Invocation JSON file (for future argv mapping)
      --dry-run     Print plan without executing (not implemented in PR1)
`);
}

async function readVersion(): Promise<string> {
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const txt = await fsp.readFile(pkgPath, "utf8");
    const pkg = JSON.parse(txt);
    if (pkg && typeof pkg.version === "string") return pkg.version as string;
  } catch {}
  return "0.0.0";
}

async function resolveRoot(): Promise<string> {
  if (process.env.JSON_CLI_ROOT) return path.resolve(process.env.JSON_CLI_ROOT);
  let dir = process.cwd();
  while (true) {
    const probe = path.join(dir, ".json-cli");
    try {
      const st = await fsp.stat(probe);
      if (st.isFile()) return dir;
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

async function readRootConfig(rootDir: string): Promise<RootConfig> {
  try {
    const txt = await fsp.readFile(path.join(rootDir, ".json-cli"), "utf8");
    const obj = JSON.parse(txt);
    const cfg: RootConfig = {};
    if (obj && typeof obj === "object") {
      if (typeof obj.defaultPackage === "string") cfg.defaultPackage = obj.defaultPackage;
      if (Array.isArray(obj.ignore))
        cfg.ignore = obj.ignore.filter((x: any) => typeof x === "string");
    }
    return cfg;
  } catch {
    return {};
  }
}

function resolveToolRef(ref: string, cfg: RootConfig): string {
  if (ref.includes(".")) return ref;
  if (!cfg.defaultPackage) return ref; // bare name; no default package known
  return `${cfg.defaultPackage}.${ref}`;
}

async function buildIndex(rootDir: string, cfg: RootConfig): Promise<Map<string, string>> {
  const idx = new Map<string, string>();
  const ignoreDirs = new Set<string>([
    "node_modules/",
    ".git/",
    "buck-out/",
    ".tmp/",
    "coverage/",
    "dist/",
    ...(cfg.ignore ?? []),
  ]);

  async function walk(dir: string) {
    const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [] as any);
    for (const ent of ents) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        const rel = path.relative(rootDir, p).replace(/\\/g, "/") + "/";
        let skip = false;
        for (const pref of ignoreDirs) {
          if (rel.startsWith(pref)) {
            skip = true;
            break;
          }
        }
        if (!skip) await walk(p);
      } else if (ent.isFile() && ent.name.endsWith(".tool.json")) {
        const spec = await readSpec(p);
        const fq =
          spec && spec.command?.package && spec.tool?.name
            ? `${spec.command.package}.${spec.tool.name}`
            : null;
        if (fq && !idx.has(fq)) idx.set(fq, p);
      }
    }
  }

  await walk(rootDir);
  return idx;
}

async function readSpec(p: string): Promise<ToolSpec | null> {
  try {
    const txt = await fsp.readFile(p, "utf8");
    const obj = JSON.parse(txt);
    return obj as ToolSpec;
  } catch {
    return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // If run directly (unlikely in this repo), execute main.
  // Buck/zx wrapper calls into this module from tools/bin/json-cli.
   
  main(process.argv.slice(2)).then((code) => {
    if (typeof code === "number") process.exit(code);
  });
}
