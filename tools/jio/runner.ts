import Ajv from "ajv";
import fg from "fast-glob";
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
    inheritCallerCwd?: boolean;
    env?: Record<string, string>;
    defaultBooleanStyle?: "presence" | "equals";
    timeoutMs?: number;
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
      console.error("jio: config error — bare name requires .jio.defaultPackage");
      return 78;
    }
    const fq = resolveToolRef(opts.where, rootCfg);
    const hit = idx.get(fq);
    if (!hit) {
      console.error(`jio: tool not found: ${fq}`);
      if (
        (rootCfg.globs && rootCfg.globs.length) ||
        (rootCfg.excludeGlobs && rootCfg.excludeGlobs.length)
      ) {
        console.error(
          "hint: tool may be excluded by globs/excludeGlobs; run 'jio --list' to inspect discovered tools",
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
    console.error("jio: config error — bare name requires .jio.defaultPackage");
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
    console.error(`jio: tool not found: ${fqTool}`);
    if (
      (rootCfg.globs && rootCfg.globs.length) ||
      (rootCfg.excludeGlobs && rootCfg.excludeGlobs.length)
    ) {
      console.error(
        "hint: tool may be excluded by globs/excludeGlobs; run 'jio --list' to inspect discovered tools",
      );
    }
    return 78;
  }
  const specRead = await readSpec(specPath);
  const spec = specRead.spec;
  if (!spec || !spec.command?.exec) {
    console.error("jio: invalid spec (missing command.exec)");
    return 78;
  }

  const requiresInput = usesPathParams(spec);
  let invObj: any = {};
  if (requiresInput || opts.inFile) {
    if (!opts.inFile && requiresInput) {
      console.error("jio: --in is required when required parameters use path");
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
          console.error(`jio: invalid input: ${msg}`);
          if (sink) await sink.close();
          return 1;
        }
      } catch (e: any) {
        console.error("jio: input validation failed");
        return 1;
      }
    }
  }

  let argvBuilt: string[];
  try {
    argvBuilt = buildArgv(spec, invObj);
  } catch (e: any) {
    console.error(String(e?.message || e || "jio: argv build failed"));
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
  if (error) console.error(`jio: ${error}`);
  console.log(`Usage: jio <toolRef> [--in file.json] [--dry-run] [--list] [--where <toolRef>]

Flags:
  -h, --help        Show help
  -v, --version     Show version
      --list        List discovered tools (FQName -> path)
      --where REF   Print the path to the tool spec for REF
      --in FILE     Invocation JSON file
      --dry-run     Print plan without executing
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
  if (process.env.JIO_ROOT) return path.resolve(process.env.JIO_ROOT);
  let dir = process.cwd();
  while (true) {
    const probe = path.join(dir, ".jio");
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
    const txt = await fsp.readFile(path.join(rootDir, ".jio"), "utf8");
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
    "coverage/",
    "dist/",
    ...(cfg.ignore ?? []),
  ]);
  const includeGlobs = cfg.globs && cfg.globs.length > 0 ? cfg.globs : ["**/*.tool.json"];
  const excludeGlobs = cfg.excludeGlobs || [];

  const entries = await fg(includeGlobs, {
    cwd: rootDir,
    ignore: [
      ...Array.from(ignoreDirs).map((d) => (d.endsWith("/") ? d + "**" : d)),
      ...excludeGlobs,
    ],
    dot: false,
    onlyFiles: true,
    unique: true,
    markDirectories: false,
    followSymbolicLinks: true,
  });

  for (const rel of entries) {
    const p = path.join(rootDir, rel);
    const { spec, warning } = await readSpec(p);
    if (warning) {
      try {
        process.stderr.write(warning + "\n");
      } catch {}
    }
    const fq =
      spec && spec.command?.package && spec.tool?.name
        ? `${spec.command.package}.${spec.tool.name}`
        : null;
    if (fq) {
      if (idx.has(fq)) {
        throw new Error(
          `jio: config error — duplicate tool FQName '${fq}' found in:\n  - ${idx.get(fq)}\n  - ${p}`,
        );
      }
      idx.set(fq, p);
    }
  }
  return idx;
}

// Formal schema (from jio.md §12)
const FORMAL_SCHEMA: any = {
  type: "object",
  required: ["tool", "command"],
  properties: {
    tool: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
      },
      additionalProperties: false,
    },
    command: {
      type: "object",
      required: ["package", "exec", "parameters"],
      properties: {
        package: { type: "string" },
        exec: { type: "string" },
        workingDir: { type: "string" },
        env: { type: "object", additionalProperties: { type: "string" } },
        defaultBooleanStyle: { type: "string", enum: ["presence", "equals"], default: "presence" },
        inheritCallerCwd: { type: "boolean", default: false },
        timeoutMs: { type: "integer", minimum: 1 },
        parameters: {
          type: "object",
          additionalProperties: {
            allOf: [
              {
                type: "object",
                properties: {
                  path: { type: "string" },
                  value: { type: "string" },
                  type: {
                    type: "string",
                    enum: ["string", "number", "boolean", "array", "object"],
                  },
                  required: { type: "boolean" },
                  default: {},
                  position: { type: "integer", minimum: 1 },
                  flag: { type: "boolean" },
                  flagName: { type: "string" },
                  booleanStyle: { type: "string", enum: ["presence", "equals"] },
                  collectionStyle: {
                    type: "string",
                    enum: ["repeatArg", "repeatFlag", "csv", "kv", "separate"],
                  },
                  csvSeparator: { type: "string", maxLength: 1 },
                },
                anyOf: [
                  { required: ["path", "type"] },
                  { required: ["value", "type"] },
                  { required: ["default", "type"] },
                ],
              },
              {
                if: { required: ["flag"], properties: { flag: { const: true } } },
                then: {
                  anyOf: [
                    { required: ["flagName"] },
                    {
                      properties: {
                        type: { const: "object" },
                        collectionStyle: { const: "kv" },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        stdinTransform: {
          type: "object",
          properties: {
            shell: { type: "string" },
            format: { type: "string", enum: ["ndjson", "json"] },
          },
          additionalProperties: false,
        },
        stdoutTransform: {
          type: "object",
          required: ["shell", "format"],
          properties: {
            shell: { type: "string" },
            format: { type: "string", enum: ["ndjson", "json"] },
          },
          additionalProperties: false,
        },
        onValidationFailure: {
          type: "object",
          properties: { shell: { type: "string" } },
          required: ["shell"],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    specVersion: { type: "string", const: "1.0.0" },
    jsonPathDialect: { type: "string", const: "jsonpath-plus@8" },
    schemaDialect: { type: "string", const: "https://json-schema.org/draft/2020-12/schema" },
  },
  additionalProperties: false,
};

let ajvFormal: Ajv | null = null;
let validateFormal: ((data: any) => boolean) | null = null;
function ensureFormalValidator() {
  if (!ajvFormal) {
    ajvFormal = new Ajv({ allErrors: false, strict: false });
    validateFormal = ajvFormal.compile(FORMAL_SCHEMA);
  }
}

async function readSpec(p: string): Promise<{ spec: ToolSpec | null; warning: string | null }> {
  try {
    const txt = await fsp.readFile(p, "utf8");
    const obj = JSON.parse(txt);
    ensureFormalValidator();
    if (validateFormal && !validateFormal(obj)) {
      const msg = JSON.stringify((validateFormal as any).errors?.[0] || {});
      return { spec: null, warning: `jio: invalid spec skipped: ${p}: ${msg}` };
    }
    return { spec: obj as ToolSpec, warning: null };
  } catch (e: any) {
    return {
      spec: null,
      warning: `jio: unreadable spec skipped: ${p}: ${String(e?.message || e)}`,
    };
  }
}

function usesPathParams(spec: ToolSpec): boolean {
  const params = spec.command?.parameters || {};
  for (const p of Object.values(params)) {
    if (!p || typeof p !== "object") continue;
    const ps = p as any;
    const hasPath: boolean = !!ps.path;
    const isRequired: boolean = !!ps.required;
    const hasDefault: boolean = Object.prototype.hasOwnProperty.call(ps, "default");
    if (hasPath && isRequired && !hasDefault) return true;
  }
  return false;
}

function buildArgv(spec: ToolSpec, invObj: any): string[] {
  const params = spec.command?.parameters || {};
  const positionals: Array<{ pos: number; tokens: string[] }> = [];
  const flags: Array<{ name: string; tokens: string[] }> = [];

  const seenPositions = new Set<number>();
  let maxPos = 0;
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
      let pos = ps.position as number | undefined;
      if (!pos || pos <= 0 || !Number.isInteger(pos)) {
        pos = maxPos + 1;
      }
      while (seenPositions.has(pos)) pos++;
      seenPositions.add(pos);
      if (pos > maxPos) maxPos = pos;
      const tokens = renderValueTokens(type, ps, value, undefined);
      if (tokens.length === 0) continue;
      positionals.push({ pos, tokens });
      continue;
    }

    const needsFlagName = !(type === "object" && ps.collectionStyle === "kv");
    if (needsFlagName && !flagName)
      throw new Error(`flag parameter missing flagName: ${paramName}`);
    const booleanStyle = ps.booleanStyle || defaultBooleanStyle;
    const rendered = renderValueTokens(
      type,
      ps,
      value,
      flagName ? flagName : undefined,
      booleanStyle,
    );
    if (rendered.length > 0) flags.push({ name: flagName || "", tokens: rendered });
  }

  positionals.sort((a, b) => a.pos - b.pos);
  flags.sort((a, b) => a.name.localeCompare(b.name));

  const argv: string[] = [];
  for (const p of positionals) argv.push(...p.tokens);
  for (const f of flags) argv.push(...f.tokens);
  return argv;
}

function resolveParamValue(ps: ParameterSpec, invObj: any): any {
  if (ps.path && ps.value) throw new Error("parameter cannot have both path and value");
  let v: any = undefined;
  if (ps.path) {
    v = evaluateJsonPath(invObj, ps.path);
  } else if (ps.value !== undefined) {
    v = ps.value;
  }
  if ((v === undefined || v === null) && ps.default !== undefined) return ps.default;
  return v;
}

// Minimal JSONPath evaluator supporting: $.a.b, .*, [index], [*], [i,j], [start:end]
function evaluateJsonPath(root: any, expr: string): any {
  if (!expr || expr[0] !== "$") return undefined;
  let i = 1; // after $
  let current: any[] = [root];

  function takeDotSegment(): string | null {
    if (expr[i] !== ".") return null;
    i++;
    if (expr[i] === "*") {
      i++;
      return "*";
    }
    let start = i;
    while (i < expr.length && /[A-Za-z0-9_]/.test(expr[i])) i++;
    return expr.slice(start, i) || null;
  }
  function takeBracket(): string | null {
    if (expr[i] !== "[") return null;
    let start = i;
    while (i < expr.length && expr[i] !== "]") i++;
    if (expr[i] !== "]") return null;
    i++; // include ]
    return expr.slice(start + 1, i - 1);
  }

  while (i < expr.length) {
    const dot = takeDotSegment();
    if (dot !== null) {
      const next: any[] = [];
      if (dot === "*") {
        for (const v of current) {
          if (v && typeof v === "object" && !Array.isArray(v)) next.push(...Object.values(v));
        }
      } else {
        for (const v of current) {
          if (v && typeof v === "object" && dot in v) next.push((v as any)[dot]);
        }
      }
      current = next;
      continue;
    }
    const br = takeBracket();
    if (br !== null) {
      const next: any[] = [];
      const s = br.trim();
      if (s === "*") {
        for (const v of current) {
          if (Array.isArray(v)) next.push(...v);
        }
      } else if (/^-?\d+$/.test(s)) {
        const idx = Number(s);
        for (const v of current) {
          if (Array.isArray(v) && idx >= 0 && idx < v.length) next.push(v[idx]);
        }
      } else if (/^-?\d+\s*:\s*-?\d*$/.test(s)) {
        const [a, b] = s.split(":");
        const start = Number(a);
        const end = b === "" ? undefined : Number(b);
        for (const v of current) {
          if (Array.isArray(v)) next.push(...v.slice(start, end));
        }
      } else if (/^-?\d+(\s*,\s*-?\d+)+$/.test(s)) {
        const parts = s.split(",").map((x) => Number(x.trim()));
        for (const v of current) {
          if (Array.isArray(v)) {
            for (const idx of parts) if (idx >= 0 && idx < v.length) next.push(v[idx]);
          }
        }
      } else if (/^(['"]).*\1(\s*,\s*(['"]).*\3)*$/.test(s)) {
        // Property-name union: $['a','b'] or $["a","b"]
        const re = /(['"])([^'"\\]*(?:\\.[^'"\\]*)*)\1/g;
        const props: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(s)) !== null) {
          const raw = m[2].replace(/\\(['"])/g, "$1");
          props.push(raw);
        }
        for (const v of current) {
          if (v && typeof v === "object" && !Array.isArray(v)) {
            for (const key of props) {
              if (key in v) next.push((v as any)[key]);
            }
          }
        }
      } else {
        // unsupported subset (scripts/functions/unions of properties)
        throw new Error(`jio: unsupported JSONPath segment: [${s}]`);
      }
      current = next;
      continue;
    }
    // unsupported token
    break;
  }
  if (current.length === 0) return undefined;
  if (current.length === 1) return current[0];
  return current;
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
      if (type === "number") {
        const n = Number(value);
        if (Number.isFinite(n) && Math.abs(n) > Math.pow(2, 53) - 1) {
          try {
            process.stderr.write("jio: warning: number may lose precision (>2^53-1)\n");
          } catch {}
        }
      }
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
      const useDashes = !!(ps as any).flag;
      return keys.map((k) => `${useDashes ? "--" : ""}${k}=${String((value as any)[k])}`);
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
  const inherit = !!spec.command?.inheritCallerCwd;
  if (inherit) {
    if (!wd) return process.cwd();
    if (path.isAbsolute(wd)) return wd;
    return path.resolve(process.cwd(), wd);
  }
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
  // Preserve user-provided debug opts; do not mutate global env here.
  const sink = openFailureSink(rootDir, specPath, spec, rootCfg);

  // Optional stdinTransform
  const stIn = spec.command?.stdinTransform;
  const preferredShell = (await hasBinaryOnPath("bash")) ? "bash" : "/bin/sh";
  const shellCmd = (script: string) =>
    preferredShell.includes("bash") ? `set -euo pipefail; ${script}` : `set -eu; ${script}`;
  const shellArgsIn = preferredShell.includes("bash")
    ? ["--noprofile", "--norc", "-c", shellCmd(stIn?.shell || "")]
    : ["-c", shellCmd(stIn?.shell || "")];
  const p1 =
    stIn && stIn.shell
      ? spawn(preferredShell, shellArgsIn, {
          cwd,
          env,
          stdio: ["pipe", "pipe", "pipe"],
          detached: true,
        })
      : null;
  const p1StdoutEnd: Promise<void> = p1
    ? new Promise<void>((res) => {
        try {
          p1.stdout.on("end", () => res());
        } catch {
          res();
        }
      })
    : Promise.resolve();

  // Determine exec command; auto-wrap with secretspec if available and enabled
  let execCmd = spec.command!.exec as string;
  let execArgv = argv.slice();
  const secretsDisabled = process.env.JIO_SECRETS_DISABLE === "1";
  const secretsForced = process.env.JIO_SECRETS === "1";
  const secretspecToml = path.join(rootDir, "secretspec.toml");
  const hasSecretsToml = await pathExists(secretspecToml);
  const shouldTrySecrets = !secretsDisabled && (secretsForced || hasSecretsToml);
  if (shouldTrySecrets && (await hasBinaryOnPath("secretspec"))) {
    const provider = process.env.JIO_SECRETS_PROVIDER;
    const profile = process.env.JIO_SECRETS_PROFILE;
    const args: string[] = ["run"];
    if (profile) args.push("--profile", profile);
    if (provider) args.push("--provider", provider);
    args.push("--", execCmd, ...execArgv);
    execCmd = "secretspec";
    execArgv = args;
  } else if (hasSecretsToml && !secretsDisabled) {
    // Only warn; do not inject or skip. Continue without secrets wrapper.
    try {
      process.stderr.write(
        "jio: warning: secretspec not found on PATH; running without secrets wrap\n",
      );
    } catch {}
  }

  // If executing a TypeScript script directly, prefer running via Node with type stripping and zx globals
  if (/\.ts$/i.test(execCmd)) {
    const nodeBin = process.env.NODE_BIN || "node";
    const wsRoot = process.env.WORKSPACE_ROOT || process.cwd();
    const zxInit = path.join(wsRoot, "tools", "dev", "zx-init.mjs");
    execArgv = [
      "--experimental-strip-types",
      "--experimental-top-level-await",
      "--disable-warning=ExperimentalWarning",
      "--import",
      zxInit,
      execCmd,
      ...execArgv,
    ];
    execCmd = nodeBin;
  }

  // Avoid sourcing user profiles which may reference unavailable tools when executing bash
  if (/(?:^|\/)bash$/.test(execCmd)) {
    execArgv = ["--noprofile", "--norc", ...execArgv];
  }

  // Convenience: if executing bash with -c/-lc only (no command), default to 'cat' to pass stdin through.
  const isBash = /(?:^|\/)bash$/.test(execCmd);
  if (isBash) {
    const idxC = execArgv.findIndex((a) => a === "-c" || a === "-lc");
    if (idxC >= 0 && idxC === execArgv.length - 1) {
      execArgv.push("cat");
    }
  }

  const cmd = spawn(execCmd, execArgv, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    // Make exec the leader of its own process group so we can signal the whole tree reliably
    detached: true,
  });

  const st = spec.command?.stdoutTransform;

  const p2: any =
    st && st.shell && st.format
      ? (() => {
          const shellArgsOut = preferredShell.includes("bash")
            ? ["--noprofile", "--norc", "-c", shellCmd(st.shell)]
            : ["-c", shellCmd(st.shell)];
          const proc = spawn(preferredShell, shellArgsOut, {
            cwd,
            env,
            stdio: ["pipe", "pipe", "pipe"],
            detached: true,
          });
          return proc;
        })()
      : null;
  const p2NonNull = p2 as any;

  // Attach waiters immediately after spawn to avoid missing early 'error' events
  const p1WaitBaseEarly = p1 ? waitProcess(p1, "stdinTransform") : Promise.resolve(0);
  const cmdWaitEarly = waitProcess(cmd, "exec");
  const p2BaseWaitEarly: Promise<number> = p2
    ? waitProcess(p2NonNull, "stdoutTransform")
    : Promise.resolve(0);
  const p2WaitEarly =
    process.env.JIO_TEST_FAST === "1"
      ? Promise.race([
          p2BaseWaitEarly,
          new Promise<number>((res) =>
            setTimeout(() => {
              try {
                p2NonNull.stdin.end();
              } catch {}
              res(0);
            }, 1500),
          ),
        ])
      : p2BaseWaitEarly;

  // Local timeout guard
  const procs = [p1, cmd, p2, sink && (sink as any).proc].filter(Boolean) as any[];
  const timeoutMs = spec.command?.timeoutMs;
  let localTimedOut = false;
  let localKiller: NodeJS.Timeout | null = null;
  const localTimeoutPromise: Promise<"TIMEOUT"> | null =
    timeoutMs && timeoutMs > 0
      ? new Promise<"TIMEOUT">((res) => {
          localKiller = setTimeout(() => {
            try {
              (sink as any)?.endInput?.();
            } catch {}
            terminateGroup(procs);
            try {
              (p2 as any)?.stdout?.destroy();
            } catch {}
            localTimedOut = true;
            res("TIMEOUT");
          }, timeoutMs);
        })
      : null;

  // Wire stderr passthrough and detect likely spawn errors in stdinTransform
  let stdinLikelySpawnError = false;
  if (p1) {
    try {
      p1.stderr.on("data", (buf: any) => {
        try {
          const s = Buffer.from(buf).toString("utf8");
          if (/No such file or directory|command not found/i.test(s)) stdinLikelySpawnError = true;
        } catch {}
      });
    } catch {}
    p1.stderr.pipe(process.stderr, { end: false });
  }
  cmd.stderr.pipe(process.stderr, { end: false });
  if (p2) p2.stderr.pipe(process.stderr, { end: false });

  // Pipe cmd stdout into transform stdin (guard absent stdio on spawn failure)
  if (cmd.stdout) {
    try {
      if (p2 && p2.stdin) cmd.stdout.pipe(p2.stdin);
      else cmd.stdout.pipe(process.stdout);
    } catch {}
    try {
      cmd.stdout.on("end", () => {
        try {
          if (p2 && p2.stdin) p2.stdin.end();
        } catch {}
      });
      cmd.on("close", () => {
        try {
          if (p2 && p2.stdin) p2.stdin.end();
        } catch {}
      });
    } catch {}
  } else {
    try {
      p2NonNull?.stdin?.end();
    } catch {}
  }

  // Feed stdin → p1? → cmd.stdin with format enforcement
  let stdinParseFailed = false;
  let stdinConfigError = false;
  let stdinForwardDone: Promise<void> | null = null;
  const waitDrain = async (w: NodeJS.WritableStream) =>
    new Promise<void>((res) => w.once("drain", res));
  if (!p1) {
    // No transform: pipe directly and ensure closure with a fallback guard
    let ended = false;
    try {
      process.stdin.pipe(cmd.stdin);
      const onEnd = () => {
        if (ended) return;
        ended = true;
        try {
          cmd.stdin.end();
        } catch {}
      };
      process.stdin.once("end", onEnd);
      process.stdin.once("close", onEnd);
      // Fallback guard: close exec stdin shortly after start if no events fire
      setTimeout(onEnd, 50);
    } catch {}
  } else {
    // process.stdin -> p1.stdin
    process.stdin.pipe(p1.stdin);
    // enforce format on p1.stdout and forward into cmd.stdin
    const format = stIn!.format;
    if (format === "ndjson") {
      const rlIn = readline.createInterface({ input: p1.stdout, crlfDelay: Infinity });
      let firstLineSeen = false;
      stdinForwardDone = (async (): Promise<void> => {
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
            process.stderr.write("jio: stdinTransform emitted non-JSON line\n");
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
      })().catch(() => {
        try {
          cmd.stdin.end();
        } catch {}
      });
    } else if (format === "json") {
      stdinForwardDone = (async (): Promise<void> => {
        const chunks: Buffer[] = [];
        for await (const chunk of p1.stdout) chunks.push(Buffer.from(chunk));
        let buf = Buffer.concat(chunks).toString("utf8");
        if (buf.charCodeAt(0) === 0xfeff) buf = buf.slice(1);
        try {
          JSON.parse(buf);
          if (!cmd.stdin.write(buf)) await waitDrain(cmd.stdin);
        } catch {
          process.stderr.write("jio: stdinTransform did not emit valid JSON\n");
          if (sink)
            await sink.write({
              reason: "stdin",
              object: buf.slice(0, 200),
              message: "invalid JSON document",
            });
          stdinParseFailed = true;
        }
        cmd.stdin.end();
      })().catch(() => {
        try {
          cmd.stdin.end();
        } catch {}
      });
    } else {
      process.stderr.write("jio: unknown stdinTransform.format\n");
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
  if (st && st.format === "ndjson") {
    let bufStr = "";
    let firstLineSeen = false;
    for await (const chunk of p2.stdout) {
      bufStr += Buffer.from(chunk).toString("utf8");
      while (true) {
        const nl = bufStr.indexOf("\n");
        if (nl < 0) break;
        let s = bufStr.slice(0, nl);
        bufStr = bufStr.slice(nl + 1);
        if (s.trim() === "") continue;
        if (!firstLineSeen) {
          firstLineSeen = true;
          if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
        }
        if (s.endsWith("\r")) s = s.slice(0, -1);
        try {
          const obj = JSON.parse(s);
          if (validate && !validate(obj)) {
            const msg = JSON.stringify(validate.errors?.[0] || {});
            process.stderr.write(`jio: invalid output item: ${msg}\n`);
            if (sink) await sink.write({ reason: "output", object: obj, message: msg });
            continue;
          }
          process.stdout.write(s + "\n");
        } catch {
          process.stderr.write("jio: invalid NDJSON line (not JSON)\n");
          if (sink)
            await sink.write({
              reason: "stdout",
              object: s.slice(0, 200),
              message: "invalid NDJSON",
            });
          // Tolerate invalid lines: route to failure sink, but do not fail the stage
        }
      }
    }
    // Handle any trailing data without newline
    const trailing = bufStr.trim();
    if (trailing) {
      let s = bufStr;
      if (!firstLineSeen && s.charCodeAt(0) === 0xfeff) s = s.slice(1);
      if (s.endsWith("\r")) s = s.slice(0, -1);
      try {
        const obj = JSON.parse(s);
        if (validate && !validate(obj)) {
          const msg = JSON.stringify(validate.errors?.[0] || {});
          process.stderr.write(`jio: invalid output item: ${msg}\n`);
          if (sink) await sink.write({ reason: "output", object: obj, message: msg });
        } else {
          process.stdout.write(s + "\n");
        }
      } catch {
        process.stderr.write("jio: invalid NDJSON trailing line (not JSON)\n");
        if (sink)
          await sink.write({
            reason: "stdout",
            object: s.slice(0, 200),
            message: "invalid NDJSON trailing",
          });
      }
    }
  } else if (st && st.format === "json") {
    const chunks: Buffer[] = [];
    for await (const chunk of p2.stdout) chunks.push(Buffer.from(chunk));
    let buf = Buffer.concat(chunks).toString("utf8");
    if (buf.charCodeAt(0) === 0xfeff) buf = buf.slice(1);
    try {
      const obj = JSON.parse(buf);
      if (validate && !validate(obj)) {
        const msg = JSON.stringify(validate.errors?.[0] || {});
        process.stderr.write(`jio: invalid output: ${msg}\n`);
        if (sink) await sink.write({ reason: "output", object: obj, message: msg });
        stdoutParseFailed = true;
      } else {
        process.stdout.write(JSON.stringify(obj));
      }
    } catch {
      process.stderr.write("jio: invalid JSON output\n");
      if (sink)
        await sink.write({
          reason: "stdout",
          object: buf.slice(0, 200),
          message: "invalid JSON document",
        });
      stdoutParseFailed = true;
    }
  } else if (st && st.shell && !st.format) {
    process.stderr.write("jio: unknown stdoutTransform.format\n");
    p2.stdout.pipe(process.stdout);
    stdoutConfigError = true;
  } else {
    // No stdoutTransform: pass through raw
    cmd.stdout?.pipe(process.stdout);
  }

  // If handler requested input/output validation failure action, run it
  if (sink) {
    try {
      // best-effort: no-op flush
    } catch {}
  }

  // Wait for stages and timeout race
  const allWait = Promise.all([cmdWaitEarly, p1WaitBaseEarly, p2WaitEarly]);
  const completedByTimeout = localTimeoutPromise
    ? (await Promise.race([allWait, localTimeoutPromise])) === "TIMEOUT"
    : false;
  const [cCode, p1Code, p2Code] = completedByTimeout
    ? [0, 0, 0]
    : await Promise.all([cmdWaitEarly, p1WaitBaseEarly, p2WaitEarly]);
  try {
    if (localKiller) clearTimeout(localKiller);
  } catch {}

  // Compute exit code precedence
  if (stdinLikelySpawnError) {
    process.stderr.write(
      `jio: failed to spawn stdinTransform: likely missing transform binary (code=69 ENOENT)\n`,
    );
    return 69;
  }
  if (stdinConfigError || stdoutConfigError) return 78;
  if (localTimedOut) {
    process.stderr.write(`jio: timeout — sent SIGTERM to process groups; will SIGKILL after 5s\n`);
    return 124;
  }
  if (stdinParseFailed) {
    try {
      process.stderr.write("stage failed: stdinTransform code=65\n");
    } catch {}
    return 65;
  }
  if (stdoutParseFailed) {
    try {
      process.stderr.write("stage failed: stdoutTransform code=65\n");
    } catch {}
    return 65;
  }
  return exitCode || cCode || p1Code || p2Code;
}

function openFailureSink(
  rootDir: string,
  specPath: string,
  spec: ToolSpec,
  rootCfg: RootConfig,
): {
  write: (obj: any) => Promise<void>;
  close: () => Promise<void>;
  proc: any;
  endInput: () => void;
} | null {
  const of = spec.command?.onValidationFailure;
  if (!of || !of.shell) return null;
  const cwd = resolveWorkingDir(rootDir, specPath, spec);
  const env = mergeEnv(rootCfg, spec);
  const sh = process.env.SHELL && process.env.SHELL.includes("bash") ? "bash" : "/bin/sh";
  const cmd = sh.includes("bash") ? `set -euo pipefail; ${of.shell}` : `set -eu; ${of.shell}`;
  const args = sh.includes("bash") ? ["--noprofile", "--norc", "-c", cmd] : ["-c", cmd];
  const p = spawn(sh, args, {
    cwd,
    env,
    stdio: ["pipe", "ignore", "pipe"],
    detached: true,
  });
  p.stderr.pipe(process.stderr, { end: false });
  const write = async (obj: any) => {
    try {
      p.stdin.write(JSON.stringify(obj) + "\n");
    } catch {}
  };
  const endInput = () => {
    try {
      p.stdin.end();
    } catch {}
  };
  const close = async () => {
    endInput();
    await new Promise<void>((res) => p.on("exit", () => res())).catch(() => undefined);
  };
  return { write, close, proc: p, endInput };
}

function terminateGroup(procs: any[]) {
  // Phase 1: SIGTERM to process groups
  for (const p of procs) {
    try {
      if (p && p.pid) {
        try {
          process.kill(-p.pid, "SIGTERM");
        } catch {
          process.kill(p.pid, "SIGTERM");
        }
      }
    } catch {}
  }
  process.stderr.write("jio: timeout — sent SIGTERM to process groups; will SIGKILL after 5s\n");
  // Phase 2 after 5s: SIGKILL
  setTimeout(() => {
    for (const p of procs) {
      try {
        if (p && p.pid) {
          try {
            process.kill(-p.pid, "SIGKILL");
          } catch {
            process.kill(p.pid, "SIGKILL");
          }
        }
      } catch {}
    }
  }, 5000);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function hasBinaryOnPath(bin: string): Promise<boolean> {
  const envPath = process.env.PATH || "";
  for (const dir of envPath.split(":")) {
    if (!dir) continue;
    const p = path.join(dir, bin);
    try {
      await fsp.access(p);
      return true;
    } catch {}
  }
  return false;
}

async function findToolSpecs(
  rootDir: string,
  includeGlobs: string[],
  excludeGlobs: string[],
): Promise<string[]> {
  // Minimal fallback: recursively list files and filter by simple **/*.tool.json include and excludes
  const out: string[] = [];
  const ignoreDirs = new Set(["node_modules", ".git", "buck-out", "coverage", "dist"]);

  async function walk(dir: string) {
    let ents: any[] = [];
    try {
      ents = await fsp.readdir(dir, { withFileTypes: true } as any);
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (ignoreDirs.has(e.name)) continue;
        await walk(p);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = path.relative(rootDir, p);
      // include: **/*.tool.json
      const inc =
        includeGlobs.length === 0 ||
        includeGlobs.some((g) => (g === "**/*.tool.json" ? rel.endsWith(".tool.json") : true));
      if (!inc) continue;
      // exclude: naive match
      const exc = excludeGlobs.some((g) => rel.includes(g.replace(/\*\*/g, "").replace(/\*/g, "")));
      if (exc) continue;
      out.push(rel);
    }
  }
  await walk(rootDir);
  return out;
}

function waitProcess(
  p: any,
  stage: "stdinTransform" | "exec" | "stdoutTransform",
): Promise<number> {
  return new Promise<number>((res) => {
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      const exitCode = code != null ? code : signal ? 143 : 0; // 143 for SIGTERM (128+15)
      res(exitCode);
    };
    const onError = (_err: any) => {
      try {
        p.stdout?.destroy();
      } catch {}
      try {
        p.stderr?.destroy();
      } catch {}
      try {
        const msg = _err && _err.message ? `: ${String(_err.message)}` : "";
        process.stderr.write(`jio: failed to spawn ${stage}${msg}\n`);
      } catch {}
      try {
        process.stderr.write(`stage failed: ${stage} code=69\n`);
      } catch {}
      res(69);
    };
    const cleanup = () => {
      try {
        p.off?.("close", onExit);
      } catch {}
      try {
        p.off?.("error", onError);
      } catch {}
    };
    try {
      p.on("close", onExit);
      p.on("error", onError);
    } catch {
      res(0);
    }
  });
}

// Execute CLI when loaded as entrypoint (normal) or even when imported by the thin bash wrapper.
// This ensures the process exits with the intended status code instead of falling through as 0.
main(process.argv.slice(2))
  .then((code) => {
    if (typeof code === "number") process.exit(code);
  })
  .catch((err) => {
    try {
      console.error(String(err?.message || err));
    } catch {}
    process.exit(1);
  });
