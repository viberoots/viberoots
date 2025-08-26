import Ajv from "ajv";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

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
  tool?: { name?: string; outputSchema?: any };
  command?: {
    package?: string;
    exec?: string;
    workingDir?: string;
    env?: Record<string, string>;
    defaultBooleanStyle?: "presence" | "equals";
    parameters?: Record<string, ParameterSpec>;
    stdinTransform?: { shell?: string; format?: "json" | "ndjson" };
    stdoutTransform?: { shell?: string; format?: "json" | "ndjson" };
    onValidationFailure?: { shell?: string };
  };
};

type ParameterSpec = {
  path?: string;
  value?: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  required?: boolean;
  default?: any;
  position?: number;
  flag?: boolean;
  flagName?: string;
  booleanStyle?: "presence" | "equals";
  collectionStyle?: "repeatArg" | "repeatFlag" | "csv" | "kv" | "separate";
  csvSeparator?: string;
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
    let idx: Map<string, string>;
    try {
      idx = await buildIndex(rootDir, rootCfg);
    } catch (e: any) {
      console.error(String(e?.message || e));
      return 78;
    }
    if (rootCfg.defaultPackage) {
      console.log(`defaultPackage: ${rootCfg.defaultPackage}`);
    }
    const entries = Array.from(idx.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [fq, p] of entries) {
      console.log(`${fq}\t${p}`);
    }
    return 0;
  }

  if (opts.where) {
    let idx: Map<string, string>;
    try {
      idx = await buildIndex(rootDir, rootCfg);
    } catch (e: any) {
      console.error(String(e?.message || e));
      return 78;
    }
    if (!opts.where.includes(".") && !rootCfg.defaultPackage) {
      console.error("json-cli: config error — bare name requires .json-cli.defaultPackage");
      return 78;
    }
    const fq = resolveToolRef(opts.where, rootCfg);
    const hit = idx.get(fq);
    if (!hit) {
      console.error(`json-cli: tool not found: ${fq}`);
      if (
        (rootCfg.globs && rootCfg.globs.length) ||
        (rootCfg.excludeGlobs && rootCfg.excludeGlobs.length)
      ) {
        console.error(
          "hint: tool may be excluded by globs/excludeGlobs; run 'json-cli --list' to inspect discovered tools",
        );
      }
      return 78;
    }
    console.log(hit);
    return 0;
  }

  if (!opts.toolRef) {
    printHelp("missing <toolRef>");
    return 2;
  }
  if (!opts.toolRef.includes(".") && !rootCfg.defaultPackage) {
    console.error("json-cli: config error — bare name requires .json-cli.defaultPackage");
    return 78;
  }
  let index: Map<string, string>;
  try {
    index = await buildIndex(rootDir, rootCfg);
  } catch (e: any) {
    console.error(String(e?.message || e));
    return 78;
  }
  const fqTool = resolveToolRef(opts.toolRef, rootCfg);
  const specPath = index.get(fqTool);
  if (!specPath) {
    console.error(`json-cli: tool not found: ${fqTool}`);
    if (
      (rootCfg.globs && rootCfg.globs.length) ||
      (rootCfg.excludeGlobs && rootCfg.excludeGlobs.length)
    ) {
      console.error(
        "hint: tool may be excluded by globs/excludeGlobs; run 'json-cli --list' to inspect discovered tools",
      );
    }
    return 78;
  }
  const spec = await readSpec(specPath);
  if (!spec || !spec.command?.exec) {
    console.error("json-cli: invalid spec (missing command.exec)");
    return 78;
  }

  const requiresInput = usesPathParams(spec);
  let invObj: any = {};
  if (requiresInput || opts.inFile) {
    if (!opts.inFile && requiresInput) {
      console.error("json-cli: --in is required when parameters use path");
      return 78;
    }
    if (opts.inFile) {
      try {
        const txt = await fsp.readFile(path.resolve(opts.inFile), "utf8");
        invObj = JSON.parse(txt);
      } catch (e: any) {
        if (e && e.code === "ENOENT") return 66;
        return 65;
      }
    }
  }

  // Validate invocation JSON against tool.inputSchema when provided
  if (spec.tool?.outputSchema || (spec as any).tool?.inputSchema) {
    // Ajv instance created below for output too; create local here for input
    const ajvIn = new Ajv({ allErrors: false, strict: false });
    const inSchema: any = (spec as any).tool?.inputSchema;
    if (inSchema) {
      try {
        const validateIn = ajvIn.compile(inSchema);
        const ok = validateIn(invObj);
        if (!ok) {
          const sink = openFailureSink(rootDir, specPath, spec, rootCfg);
          const msg = JSON.stringify(validateIn.errors?.[0] || {});
          if (sink) await sink.write({ reason: "input", object: invObj, message: msg });
          console.error(`json-cli: invalid input: ${msg}`);
          if (sink) await sink.close();
          return 1;
        }
      } catch (e: any) {
        console.error("json-cli: input validation failed");
        return 1;
      }
    }
  }

  let argvBuilt: string[];
  try {
    argvBuilt = buildArgv(spec, invObj);
  } catch (e: any) {
    console.error(String(e?.message || e || "json-cli: argv build failed"));
    return 78;
  }

  if (opts.dryRun) {
    const plan = buildDryRunPlan(rootDir, specPath, spec, argvBuilt, rootCfg);
    console.log(JSON.stringify(plan));
    return 0;
  }

  const code = await runWithTransforms(rootDir, specPath, spec, argvBuilt, rootCfg, invObj);
  return code;
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
      if (Array.isArray(obj.globs)) cfg.globs = obj.globs.filter((x: any) => typeof x === "string");
      if (Array.isArray(obj.excludeGlobs))
        cfg.excludeGlobs = obj.excludeGlobs.filter((x: any) => typeof x === "string");
      if (obj.env && typeof obj.env === "object") {
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(obj.env)) {
          if (typeof v === "string") env[k] = v;
        }
        cfg.env = env;
      }
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
  const includeGlobs = cfg.globs && cfg.globs.length > 0 ? cfg.globs : ["**/*.tool.json"];
  const excludeGlobs = cfg.excludeGlobs || [];

  const includeRes = includeGlobs.map(globToRegExp);
  const excludeRes = excludeGlobs.map(globToRegExp);

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
        const relFile = path.relative(rootDir, p).replace(/\\/g, "/");
        const included = includeRes.some((re) => re.test(relFile));
        const excluded = excludeRes.some((re) => re.test(relFile));
        if (!included || excluded) continue;
        const spec = await readSpec(p);
        const fq =
          spec && spec.command?.package && spec.tool?.name
            ? `${spec.command.package}.${spec.tool.name}`
            : null;
        if (fq) {
          if (idx.has(fq)) {
            throw new Error(
              `json-cli: config error — duplicate tool FQName '${fq}' found in:\n  - ${idx.get(
                fq,
              )}\n  - ${p}`,
            );
          }
          idx.set(fq, p);
        }
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

function usesPathParams(spec: ToolSpec): boolean {
  const params = spec.command?.parameters || {};
  for (const p of Object.values(params)) {
    if (p && typeof p === "object" && (p as any).path) return true;
  }
  return false;
}

function buildArgv(spec: ToolSpec, invObj: any): string[] {
  const params = spec.command?.parameters || {};
  const positionals: Array<{ pos: number; token: string }> = [];
  const flags: Array<{ name: string; tokens: string[] }> = [];

  const seenPositions = new Set<number>();
  const defaultBooleanStyle: "presence" | "equals" =
    spec.command?.defaultBooleanStyle === "equals" ? "equals" : "presence";

  for (const [paramName, psRaw] of Object.entries(params)) {
    const ps = psRaw as ParameterSpec;
    const value = resolveParamValue(ps, invObj);
    const required = !!ps.required;
    const type = ps.type;
    const flag = !!ps.flag;
    const flagName = ps.flagName;

    const isEmptyArray = type === "array" && Array.isArray(value) && value.length === 0;
    const isEmptyObject =
      type === "object" && value && typeof value === "object" && Object.keys(value).length === 0;
    if (value === undefined || value === null || isEmptyArray || isEmptyObject) {
      if (required) throw new Error(`missing required parameter: ${paramName}`);
      continue;
    }

    if (!flag) {
      const pos = ps.position;
      if (!pos || pos <= 0 || !Number.isInteger(pos))
        throw new Error(`invalid or missing position for parameter: ${paramName}`);
      if (seenPositions.has(pos)) throw new Error(`duplicate positional index: ${pos}`);
      seenPositions.add(pos);
      const tokens = renderValueTokens(type, ps, value, undefined);
      if (tokens.length !== 1)
        throw new Error(`positional parameter must render to exactly one token: ${paramName}`);
      positionals.push({ pos, token: tokens[0] });
      continue;
    }

    if (!flagName) throw new Error(`flag parameter missing flagName: ${paramName}`);
    const booleanStyle = ps.booleanStyle || defaultBooleanStyle;
    const rendered = renderValueTokens(type, ps, value, flagName, booleanStyle);
    if (rendered.length > 0) flags.push({ name: flagName, tokens: rendered });
  }

  positionals.sort((a, b) => a.pos - b.pos);
  flags.sort((a, b) => a.name.localeCompare(b.name));

  const argv: string[] = [];
  for (const p of positionals) argv.push(p.token);
  for (const f of flags) argv.push(...f.tokens);
  return argv;
}

function resolveParamValue(ps: ParameterSpec, invObj: any): any {
  if (ps.path && ps.value) throw new Error("parameter cannot have both path and value");
  let v: any = undefined;
  if (ps.path) {
    v = extractBySimpleJsonPath(invObj, ps.path);
  } else if (ps.value !== undefined) {
    v = ps.value;
  }
  if ((v === undefined || v === null) && ps.default !== undefined) return ps.default;
  return v;
}

function extractBySimpleJsonPath(obj: any, pathExpr: string): any {
  if (!pathExpr.startsWith("$")) return undefined;
  let cur: any = obj;
  const trimmed = pathExpr.replace(/^\$[.]/, "");
  if (trimmed === "" || trimmed === "$") return cur;
  const parts = trimmed.split(".");
  for (const part of parts) {
    if (part === "") continue;
    const m = part.match(/^(\w+)(\[(\d+)\])?$/);
    if (!m) return undefined;
    const key = m[1];
    if (cur == null || typeof cur !== "object" || !(key in cur)) return undefined;
    cur = (cur as any)[key];
    if (m[3] !== undefined) {
      const idx = Number(m[3]);
      if (!Array.isArray(cur) || idx < 0 || idx >= cur.length) return undefined;
      cur = cur[idx];
    }
  }
  return cur;
}

function renderValueTokens(
  type: ParameterSpec["type"],
  ps: ParameterSpec,
  value: any,
  flagName?: string,
  booleanStyle: "presence" | "equals" = "presence",
): string[] {
  switch (type) {
    case "string":
    case "number": {
      const str = String(value);
      if (!flagName) return [str];
      if (ps.collectionStyle === "separate") return [flagName, str];
      return [`${flagName}=${str}`];
    }
    case "boolean": {
      const b = !!value;
      if (!flagName) return [String(b)];
      if (booleanStyle === "equals") return [`${flagName}=${b ? "true" : "false"}`];
      return b ? [flagName] : [];
    }
    case "array": {
      if (!Array.isArray(value)) return [];
      const style = ps.collectionStyle;
      if (!style) throw new Error("array parameter requires collectionStyle");
      if (style === "repeatArg") return value.map((v) => String(v));
      if (style === "csv") {
        const sep = ps.csvSeparator || ",";
        const joined = value.map((v) => String(v)).join(sep);
        if (!flagName) return [joined];
        if (ps.collectionStyle === "separate") return [flagName, joined];
        return [`${flagName}=${joined}`];
      }
      if (style === "repeatFlag") {
        if (!flagName) throw new Error("repeatFlag requires flagName");
        return value.map((v) => `${flagName}=${String(v)}`);
      }
      if (style === "separate") {
        if (!flagName) throw new Error("separate requires flagName");
        return [flagName, String(value.join(ps.csvSeparator || ","))];
      }
      throw new Error(`unsupported array collectionStyle: ${style}`);
    }
    case "object": {
      if (!value || typeof value !== "object") return [];
      const style = ps.collectionStyle;
      if (style !== "kv") throw new Error("object parameter requires collectionStyle=kv");
      const keys = Object.keys(value).sort();
      if (!flagName) return keys.map((k) => `${k}=${String((value as any)[k])}`);
      return keys.map((k) => `--${k}=${String((value as any)[k])}`);
    }
    default:
      return [];
  }
}

function buildDryRunPlan(
  rootDir: string,
  specPath: string,
  spec: ToolSpec,
  argv: string[],
  rootCfg: RootConfig,
) {
  const cwd = resolveWorkingDir(rootDir, specPath, spec);
  const env = mergeEnv(rootCfg, spec);
  return {
    exec: spec.command?.exec,
    argv,
    cwd,
    envKeys: Object.keys(env).sort(),
    stdoutTransform: spec.command?.stdoutTransform?.shell,
    stdinTransform: spec.command?.stdinTransform?.shell,
  };
}

function resolveWorkingDir(_rootDir: string, specPath: string, spec: ToolSpec): string {
  const wd = spec.command?.workingDir;
  if (!wd) return path.dirname(specPath);
  if (path.isAbsolute(wd)) return wd;
  return path.resolve(path.dirname(specPath), wd);
}

function mergeEnv(rootCfg: RootConfig, spec: ToolSpec): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  for (const [k, v] of Object.entries(rootCfg.env || {})) env[k] = v;
  for (const [k, v] of Object.entries(spec.command?.env || {})) env[k] = v;
  return env;
}

function globToRegExp(glob: string): RegExp {
  // very small glob: **, *, and literal dots/slashes
  let g = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  g = g.replace(/\\\\/g, "/");
  g = g.replace(/\*\*/g, ".*?");
  g = g.replace(/\*/g, "[^/]*?");
  return new RegExp("^" + g + "$");
}

async function runWithTransforms(
  rootDir: string,
  specPath: string,
  spec: ToolSpec,
  argv: string[],
  rootCfg: RootConfig,
  invObj: any,
): Promise<number> {
  const cwd = resolveWorkingDir(rootDir, specPath, spec);
  const env = mergeEnv(rootCfg, spec);
  const sink = openFailureSink(rootDir, specPath, spec, rootCfg);

  // Optional stdinTransform
  const stIn = spec.command?.stdinTransform;
  const p1 =
    stIn && stIn.shell
      ? spawn("/bin/sh", ["-c", `set -euo pipefail; ${stIn.shell}`], {
          cwd,
          env,
          stdio: ["pipe", "pipe", "pipe"],
          detached: true,
        })
      : null;

  const cmd = spawn(spec.command!.exec as string, argv, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });

  const st = spec.command?.stdoutTransform;
  if (!st || !st.shell || !st.format) {
    console.error("json-cli: stdoutTransform with shell and format is required");
    if (p1) p1.kill("SIGTERM");
    cmd.kill("SIGTERM");
    return 78;
  }

  const p2 = spawn("/bin/sh", ["-c", `set -euo pipefail; ${st.shell}`], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });

  // Wire stderr passthrough
  if (p1) p1.stderr.pipe(process.stderr, { end: false });
  cmd.stderr.pipe(process.stderr, { end: false });
  p2.stderr.pipe(process.stderr, { end: false });

  // Pipe cmd stdout into transform stdin
  cmd.stdout.pipe(p2.stdin);

  // Feed stdin → p1? → cmd.stdin with format enforcement
  let stdinParseFailed = false;
  let stdinConfigError = false;
  const waitDrain = async (w: NodeJS.WritableStream) =>
    new Promise<void>((res) => (w.writableNeedDrain ? w.once("drain", res) : res()));
  if (!p1) {
    // No transform; wire stdin directly
    process.stdin.pipe(cmd.stdin);
  } else {
    // process.stdin -> p1.stdin
    process.stdin.pipe(p1.stdin);
    // enforce format on p1.stdout and forward into cmd.stdin
    const format = stIn!.format;
    if (format === "ndjson") {
      const rlIn = readline.createInterface({ input: p1.stdout });
      let firstLineSeen = false;
      (async () => {
        for await (const line of rlIn) {
          let s = String(line);
          if (s.trim() === "") continue;
          if (!firstLineSeen) {
            firstLineSeen = true;
            if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
          }
          try {
            JSON.parse(s);
            if (!cmd.stdin.write(s + "\n")) await waitDrain(cmd.stdin);
          } catch {
            process.stderr.write("json-cli: stdinTransform emitted non-JSON line\n");
            if (sink)
              await sink.write({
                reason: "stdin",
                object: s.slice(0, 200),
                message: "invalid JSON line",
              });
            stdinParseFailed = true;
          }
        }
        cmd.stdin.end();
      })().catch(() => cmd.stdin.end());
    } else if (format === "json") {
      (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of p1.stdout) chunks.push(Buffer.from(chunk));
        let buf = Buffer.concat(chunks).toString("utf8");
        if (buf.charCodeAt(0) === 0xfeff) buf = buf.slice(1);
        try {
          JSON.parse(buf);
          if (!cmd.stdin.write(buf)) await waitDrain(cmd.stdin);
        } catch {
          process.stderr.write("json-cli: stdinTransform did not emit valid JSON\n");
          if (sink)
            await sink.write({
              reason: "stdin",
              object: buf.slice(0, 200),
              message: "invalid JSON document",
            });
          stdinParseFailed = true;
        }
        cmd.stdin.end();
      })().catch(() => cmd.stdin.end());
    } else {
      process.stderr.write("json-cli: unknown stdinTransform.format\n");
      p1.stdout.pipe(cmd.stdin);
      stdinConfigError = true;
    }
  }

  // Output validation
  const ajv = new Ajv({ allErrors: false, strict: false });
  const schema = spec.tool?.outputSchema;
  const validate = schema ? ajv.compile(schema) : null;

  let exitCode = 0;
  let stdoutParseFailed = false;
  let stdoutConfigError = false;
  if (st.format === "ndjson") {
    const rl = readline.createInterface({ input: p2.stdout });
    let firstLineSeen = false;
    for await (const line of rl) {
      let s = String(line);
      if (s.trim() === "") continue;
      if (!firstLineSeen) {
        firstLineSeen = true;
        if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
      }
      try {
        const obj = JSON.parse(s);
        if (validate && !validate(obj)) {
          const msg = JSON.stringify(validate.errors?.[0] || {});
          process.stderr.write(`json-cli: invalid output item: ${msg}\n`);
          if (sink) await sink.write({ reason: "output", object: obj, message: msg });
          // Continue streaming; drop invalid item
          continue;
        }
        if (!process.stdout.write(s + "\n")) await waitDrain(process.stdout);
      } catch {
        process.stderr.write("json-cli: invalid NDJSON line (not JSON)\n");
        if (sink)
          await sink.write({
            reason: "stdout",
            object: s.slice(0, 200),
            message: "invalid NDJSON",
          });
        stdoutParseFailed = true;
      }
    }
  } else if (st.format === "json") {
    const chunks: Buffer[] = [];
    for await (const chunk of p2.stdout) chunks.push(Buffer.from(chunk));
    let buf = Buffer.concat(chunks).toString("utf8");
    if (buf.charCodeAt(0) === 0xfeff) buf = buf.slice(1);
    try {
      const obj = JSON.parse(buf);
      if (validate && !validate(obj)) {
        const msg = JSON.stringify(validate.errors?.[0] || {});
        process.stderr.write(`json-cli: invalid output: ${msg}\n`);
        if (sink) await sink.write({ reason: "output", object: obj, message: msg });
        exitCode = exitCode || 1;
      }
      if (!process.stdout.write(buf)) await waitDrain(process.stdout);
    } catch {
      process.stderr.write("json-cli: stdoutTransform did not emit valid JSON\n");
      if (sink)
        await sink.write({ reason: "stdout", object: buf.slice(0, 200), message: "invalid JSON" });
      stdoutParseFailed = true;
    }
  } else {
    process.stderr.write("json-cli: unknown stdoutTransform.format\n");
    stdoutConfigError = true;
  }

  // Await processes end
  // Timeout handling (optional)
  const procs = [p1, cmd, p2, sink && (sink as any).proc].filter(Boolean) as any[];
  let killer: NodeJS.Timeout | null = null;
  const timeoutMs = spec.command?.timeoutMs;
  if (timeoutMs && timeoutMs > 0) {
    killer = setTimeout(() => terminateGroup(procs), timeoutMs);
  }

  function waitProcess(
    p: any,
    stage: "stdinTransform" | "exec" | "stdoutTransform",
  ): Promise<number> {
    return new Promise<number>((res) => {
      const onExit = (code: number | null) => {
        cleanup();
        res(code ?? 0);
      };
      const onError = (err: any) => {
        // Map spawn failure to 69 and print diagnostics
        try {
          process.stderr.write(
            `json-cli: failed to spawn ${stage}: ${String(err?.message || err)} (code=${err?.code || "ERR"})\n`,
          );
        } catch {}
        try {
          p.stdout?.destroy();
        } catch {}
        try {
          p.stderr?.destroy();
        } catch {}
        cleanup();
        res(69);
      };
      const cleanup = () => {
        try {
          p.off("exit", onExit);
        } catch {}
        try {
          p.off("error", onError);
        } catch {}
      };
      p.on("exit", onExit);
      p.on("error", onError);
    });
  }

  const [p1Code, cCode, p2Code] = await Promise.all([
    p1 ? waitProcess(p1, "stdinTransform") : Promise.resolve(0),
    waitProcess(cmd, "exec"),
    waitProcess(p2, "stdoutTransform"),
  ]);

  if (killer) clearTimeout(killer);
  if (sink) await sink.close();

  // Exit precedence: stdinTransform → exec → stdoutTransform
  if (stdinConfigError || stdinParseFailed || p1Code !== 0) {
    const code = stdinConfigError ? 78 : p1Code !== 0 ? p1Code : 65;
    process.stderr.write(`json-cli: stage failed: stdinTransform code=${code}\n`);
    return code;
  }
  if (cCode !== 0) {
    process.stderr.write(`json-cli: stage failed: exec code=${cCode}\n`);
    return cCode;
  }
  if (stdoutConfigError || stdoutParseFailed || p2Code !== 0) {
    const code = stdoutConfigError ? 78 : p2Code !== 0 ? p2Code : 65;
    process.stderr.write(`json-cli: stage failed: stdoutTransform code=${code}\n`);
    return code;
  }
  return 0;
}

function openFailureSink(
  rootDir: string,
  specPath: string,
  spec: ToolSpec,
  rootCfg: RootConfig,
): { write: (obj: any) => Promise<void>; close: () => Promise<void> } | null {
  const of = spec.command?.onValidationFailure;
  if (!of || !of.shell) return null;
  const cwd = resolveWorkingDir(rootDir, specPath, spec);
  const env = mergeEnv(rootCfg, spec);
  const p = spawn("/bin/sh", ["-c", `set -euo pipefail; ${of.shell}`], {
    cwd,
    env,
    stdio: ["pipe", "ignore", "pipe"],
    detached: false,
  });
  p.stderr.pipe(process.stderr, { end: false });
  const write = async (obj: any) => {
    try {
      p.stdin.write(JSON.stringify(obj) + "\n");
    } catch {}
  };
  const close = async () => {
    try {
      p.stdin.end();
    } catch {}
    await new Promise<void>((res) => p.on("exit", () => res())).catch(() => undefined);
  };
  return { write, close };
}

function terminateGroup(procs: any[]) {
  // Phase 1: SIGTERM to process groups
  for (const p of procs) {
    try {
      if (p && p.pid) process.kill(-p.pid, "SIGTERM");
    } catch {}
  }
  process.stderr.write(
    "json-cli: timeout — sent SIGTERM to process groups; will SIGKILL after 5s\n",
  );
  // Phase 2 after 5s: SIGKILL
  setTimeout(() => {
    for (const p of procs) {
      try {
        if (p && p.pid) process.kill(-p.pid, "SIGKILL");
      } catch {}
    }
  }, 5000);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // If run directly (unlikely in this repo), execute main.
  // Buck/zx wrapper calls into this module from tools/bin/json-cli.

  main(process.argv.slice(2)).then((code) => {
    if (typeof code === "number") process.exit(code);
  });
}
