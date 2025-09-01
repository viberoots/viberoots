import fg from "fast-glob";
import { spawn } from "node:child_process";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { PassThrough } from "node:stream";
import { evaluateJsonPathString as evaluateJsonPathRfc } from "./jsonpath/index.ts";
import { createAjvValidator, generateInputSchemaFromParameters } from "./schema/index.ts";
import { createAjv } from "./validation/ajv.ts";

// Parent stdio EPIPE handling: exit(0) on broken pipe like Unix CLIs
class ProcessGroupManager {
  private processes: any[] = [];
  private sink: any = null;
  private terminated: boolean = false;
  register(processes: any[], sink: any) {
    this.processes = processes || [];
    this.sink = sink || null;
    this.terminated = false;
  }
  terminateOnce(_reason: string) {
    if (this.terminated) return;
    this.terminated = true;
    try {
      (this.sink as any)?.endInput?.();
    } catch {}
    try {
      terminateGroup(this.processes);
    } catch {}
  }
  clear() {
    this.processes = [];
    this.sink = null;
    this.terminated = false;
  }
}
let CURRENT_MANAGER: ProcessGroupManager | null = null;
function setCurrentManager(m: ProcessGroupManager | null) {
  CURRENT_MANAGER = m;
}
try {
  process.stdout.on("error", (e: any) => {
    if (e && (e as any).code === "EPIPE") {
      try {
        try {
          CURRENT_MANAGER?.terminateOnce("epipe-stdout");
        } catch {}
      } finally {
        process.exit(0);
      }
    }
  });
  process.stderr.on("error", (e: any) => {
    if (e && (e as any).code === "EPIPE") {
      try {
        try {
          CURRENT_MANAGER?.terminateOnce("epipe-stderr");
        } catch {}
      } finally {
        process.exit(0);
      }
    }
  });
} catch {}

type CliOpts = {
  help: boolean;
  version: boolean;
  list: boolean;
  where: string | null;
  inFile: string | null;
  dryRun: boolean;
  toolRef: string | null;
  collect: boolean;
  collectLimit?: number;
  collectBytes?: number;
  // Limits (CLI overrides)
  maxArgvTokens?: number;
  maxArgvBytes?: number;
  maxStdinBytes?: number;
  maxStdoutJsonBytes?: number;
  maxNdjsonLineBytes?: number;
  timeoutMsOverride?: number;
  // Env handling
  cleanEnv: boolean;
  passEnv: string[];
  setEnv: Record<string, string>;
};

export type RootConfig = {
  defaultPackage?: string;
  ignore?: string[];
  globs?: string[];
  excludeGlobs?: string[];
  env?: Record<string, string>;
};

export type ToolSpec = {
  tool?: { name?: string; inputSchema?: any; outputSchema?: any };
  command?: {
    package?: string;
    exec?: string;
    workingDir?: string;
    inheritCallerCwd?: boolean;
    env?: Record<string, string>;
    envPassthrough?: string[];
    defaultBooleanStyle?: "presence" | "equals";
    timeoutMs?: number;
    limits?: {
      maxArgvTokens?: number;
      maxArgvBytes?: number;
      maxStdinBytes?: number;
      maxStdoutJsonBytes?: number;
      maxNdjsonLineBytes?: number;
      collectItems?: number;
      collectBytes?: number;
      // Failure sink reliability caps
      sinkMaxBytes?: number;
      sinkMaxItems?: number;
      sinkMaxRatePerSec?: number;
      sinkWriteTimeoutMs?: number;
      sinkCloseTimeoutMs?: number;
    };
    parameters?: Record<string, ParameterSpec>;
    stdinTransform?: { shell?: string; format?: "json" | "ndjson" };
    stdoutTransform?: { shell?: string; format?: "json" | "ndjson" };
    onValidationFailure?: { shell?: string };
  };
};

export type ParameterSpec = {
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

  // PR2: MCP server entrypoint (stdio only)
  if ((argv || []).includes("--mcp-server")) {
    try {
      const { startMcpServer } = await import("./mcp/server.ts");
      const transport = (getStringFlag(argv, "--transport") as "stdio" | undefined) || "stdio";
      await startMcpServer({
        transport,
        httpHost: getStringFlag(argv, "--http-host"),
        httpPort: getNumericFlag(argv, "--http-port"),
        timeoutMs: getNumericFlag(argv, "--timeout-ms"),
        collectLimit: getNumericFlag(argv, "--collect-limit"),
        collectBytes: getNumericFlag(argv, "--collect-bytes"),
        cleanEnv: !argv.includes("--no-clean-env"),
        passEnv: getRepeatedFlags(argv, "--pass-env"),
        setEnv: Object.fromEntries(getKvFlags(argv, "--env")),
        // PR4: server-level limits and concurrency
        maxArgvTokens: getNumericFlag(argv, "--max-argv-tokens"),
        maxArgvBytes: getNumericFlag(argv, "--max-argv-bytes"),
        maxStdinBytes: getNumericFlag(argv, "--max-stdin-bytes"),
        maxStdoutJsonBytes: getNumericFlag(argv, "--max-stdout-json-bytes"),
        maxNdjsonLineBytes: getNumericFlag(argv, "--max-ndjson-line-bytes"),
        maxItemsPerCall: getNumericFlag(argv, "--max-items-per-call"),
        maxCollectBytes: getNumericFlag(argv, "--collect-bytes"),
        maxConcurrentCalls: getNumericFlag(argv, "--max-concurrent-calls"),
        queueSize: getNumericFlag(argv, "--queue-size"),
        queueTimeoutMs: getNumericFlag(argv, "--queue-timeout-ms"),
      });
      return; // keep process alive for server
    } catch (e: any) {
      console.error(String(e?.message || e));
      return 78;
    }
  }

  const rootDir = await resolveRoot();
  const rootCfg = await readRootConfig(rootDir);

  // List mode
  {
    const listCode = await maybeHandleListMode(opts, rootDir, rootCfg);
    if (listCode !== null) return listCode;
  }

  // Where mode
  {
    const whereCode = await maybeHandleWhereMode(opts, rootCfg, rootDir);
    if (whereCode !== null) return whereCode;
  }

  if (!opts.toolRef) {
    printHelp("missing <toolRef>");
    return 2;
  }
  if (!opts.toolRef.includes(".") && !rootCfg.defaultPackage) {
    console.error("jio: config error — bare name requires .jio.defaultPackage");
    return 78;
  }
  const {
    index,
    specPath,
    code: specResolveCode,
  } = await resolveSpecPathOrExit(opts.toolRef as string, rootCfg, rootDir);
  if (specResolveCode !== null) return specResolveCode;
  const specPathStr = specPath as string;
  const specRead = await readSpec(specPathStr);
  const spec = specRead.spec;
  if (!spec || !spec.command?.exec) {
    console.error("jio: invalid spec (missing command.exec)");
    return 78;
  }

  // Schema printing mode
  const schemaExit = handleSchemaPrinting(spec, argv);
  if (schemaExit !== null) return schemaExit;

  // Input resolution
  const invState = await resolveInvocationObject(spec, opts);
  if (typeof invState.code === "number") return invState.code;
  const invObj = invState.invObj as any;

  // Validate invocation JSON against tool.inputSchema when provided
  if (spec.tool?.outputSchema || (spec as any).tool?.inputSchema) {
    const ajvIn = createAjv();
    const inSchema: any = (spec as any).tool?.inputSchema;
    if (inSchema) {
      try {
        const validateIn = ajvIn.compile(inSchema);
        const ok = validateIn(invObj);
        if (!ok) {
          const sink = openFailureSink(rootDir, specPathStr, spec, rootCfg, {
            cleanEnv: opts.cleanEnv,
            passEnv: opts.passEnv,
            setEnv: opts.setEnv,
            collect: false,
            timeoutMsOverride: undefined,
          } as any);
          const msg = JSON.stringify(validateIn.errors?.[0] || {});
          if (sink) await sink.write({ reason: "input", object: invObj, message: msg });
          console.error(`jio: invalid input: ${msg}`);
          if (sink) await sink.close();
          return 1;
        }
      } catch (e: any) {
        const sink = openFailureSink(rootDir, specPathStr, spec, rootCfg, {
          cleanEnv: opts.cleanEnv,
          passEnv: opts.passEnv,
          setEnv: opts.setEnv,
          collect: false,
          timeoutMsOverride: undefined,
        } as any);
        try {
          if (sink)
            await sink.write({
              reason: "input",
              object: invObj,
              message: "input validation failed",
            });
        } catch {}
        try {
          console.error("jio: invalid input");
        } catch {}
        try {
          if (sink) await sink.close();
        } catch {}
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
    const plan = buildDryRunPlan(rootDir, specPathStr, spec, argvBuilt, rootCfg);
    console.log(JSON.stringify(plan));
    return 0;
  }

  const code = await runWithTransforms(rootDir, specPathStr, spec, argvBuilt, rootCfg, invObj, {
    collect: !!opts.collect,
    collectLimit: opts.collectLimit,
    limits: {
      maxArgvTokens: opts.maxArgvTokens,
      maxArgvBytes: opts.maxArgvBytes,
      maxStdinBytes: opts.maxStdinBytes,
      maxStdoutJsonBytes: opts.maxStdoutJsonBytes,
      maxNdjsonLineBytes: opts.maxNdjsonLineBytes,
      collectItems: opts.collectLimit,
      collectBytes: opts.collectBytes,
    },
    timeoutMsOverride: opts.timeoutMsOverride,
    cleanEnv: opts.cleanEnv,
    passEnv: opts.passEnv,
    setEnv: opts.setEnv,
  });
  return code;
}

function getNumericFlag(argv: string[], name: string): number | undefined {
  const i = argv.indexOf(name);
  if (i >= 0) {
    const n = Number(argv[i + 1] || "");
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return undefined;
}

function getStringFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i >= 0) {
    const v = String(argv[i + 1] || "").trim();
    if (v) return v;
  }
  return undefined;
}

function getRepeatedFlags(argv: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) {
      const v = String(argv[i + 1] || "").trim();
      if (v) out.push(v);
      i++;
    }
  }
  return out;
}

function getKvFlags(argv: string[], name: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) {
      const v = String(argv[i + 1] || "");
      const idx = v.indexOf("=");
      if (idx > 0) out.push([v.slice(0, idx), v.slice(idx + 1)]);
      i++;
    }
  }
  return out;
}

function parseArgs(argv: string[]): CliOpts {
  function normalizeEquals(args: string[]): string[] {
    const out: string[] = [];
    for (const a of args) {
      if (a.startsWith("--") && a.includes("=")) {
        const idx = a.indexOf("=");
        const name = a.slice(0, idx);
        const value = a.slice(idx + 1);
        out.push(name, value);
      } else {
        out.push(a);
      }
    }
    return out;
  }
  const out: CliOpts = {
    help: false,
    version: false,
    list: false,
    where: null,
    inFile: null,
    dryRun: false,
    toolRef: null,
    collect: false,
    collectBytes: undefined,
    cleanEnv: true,
    passEnv: [],
    setEnv: {},
  };
  const rest: string[] = [];
  const tokens = normalizeEquals(argv);
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--version" || a === "-v") out.version = true;
    else if (a === "--list") out.list = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--in") out.inFile = tokens[++i] ?? null;
    else if (a === "--where") out.where = tokens[++i] ?? null;
    else if (a === "--collect" || a === "--collect-ndjson") out.collect = true;
    else if (a === "--collect-limit") {
      const n = Number(tokens[++i] ?? "");
      if (Number.isFinite(n) && n >= 0) out.collectLimit = Math.floor(n);
    } else if (a === "--collect-bytes") {
      const n = Number(tokens[++i] ?? "");
      if (Number.isFinite(n) && n >= 0) out.collectBytes = Math.floor(n);
    } else if (a === "--max-argv-tokens") {
      const n = Number(tokens[++i] ?? "");
      if (Number.isFinite(n) && n >= 0) out.maxArgvTokens = Math.floor(n);
    } else if (a === "--max-argv-bytes") {
      const n = Number(tokens[++i] ?? "");
      if (Number.isFinite(n) && n >= 0) out.maxArgvBytes = Math.floor(n);
    } else if (a === "--max-stdin-bytes") {
      const n = Number(tokens[++i] ?? "");
      if (Number.isFinite(n) && n >= 0) out.maxStdinBytes = Math.floor(n);
    } else if (a === "--max-stdout-json-bytes") {
      const n = Number(tokens[++i] ?? "");
      if (Number.isFinite(n) && n >= 0) out.maxStdoutJsonBytes = Math.floor(n);
    } else if (a === "--max-ndjson-line-bytes") {
      const n = Number(tokens[++i] ?? "");
      if (Number.isFinite(n) && n >= 0) out.maxNdjsonLineBytes = Math.floor(n);
    } else if (a === "--timeout-ms") {
      const n = Number(tokens[++i] ?? "");
      if (Number.isFinite(n) && n >= 0) out.timeoutMsOverride = Math.floor(n);
    } else if (a === "--no-clean-env") {
      out.cleanEnv = false;
    } else if (a === "--clean-env") {
      out.cleanEnv = true;
    } else if (a === "--pass-env") {
      const name = String(tokens[++i] ?? "").trim();
      if (name) out.passEnv.push(name);
    } else if (a === "--env") {
      const kv = String(tokens[++i] ?? "");
      const eq = kv.indexOf("=");
      if (eq > 0) {
        const k = kv.slice(0, eq);
        const v = kv.slice(eq + 1);
        out.setEnv[k] = v;
      }
    } else if (a.startsWith("-")) {
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
      --collect     For ndjson output, return a single JSON array instead of lines
      --collect-limit N  Max number of items to collect before failing (default: unlimited)
      --collect-bytes N  Max total bytes of collected items before failing (default: unlimited)
      --timeout-ms N      Override spec timeout (ms)
      --max-argv-tokens N  Cap number of argv tokens
      --max-argv-bytes N   Cap total argv bytes
      --max-stdin-bytes N  Cap bytes read from stdin
      --max-stdout-json-bytes N  Cap size of JSON output
      --max-ndjson-line-bytes N  Cap per-line NDJSON bytes
      --clean-env | --no-clean-env  Use minimal env by default; disable to passthrough all
      --pass-env NAME      Pass specific env var from parent (repeatable)
      --env NAME=VALUE     Set explicit env var for child (repeatable)
      --input-schema       Print effective input schema (explicit or inferred)
      --output-schema      Print output schema; if absent, prints nothing and exits non-zero

Environment:
  JIO_SINK_DEBUG=1  Emit a one-line summary of failure sink drops/limits at shutdown

Spec limits (command.limits):
  sinkMaxBytes (default 1MiB), sinkMaxItems (1000), sinkMaxRatePerSec (100/s)
  sinkWriteTimeoutMs (500), sinkCloseTimeoutMs (1000)
`);
}

async function maybeHandleListMode(
  opts: CliOpts,
  rootDir: string,
  rootCfg: RootConfig,
): Promise<number | null> {
  if (!opts.list) return null;
  try {
    const idx = await buildIndex(rootDir, rootCfg);
    if (rootCfg.defaultPackage) console.log(`defaultPackage: ${rootCfg.defaultPackage}`);
    const entries = Array.from(idx.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [fq, p] of entries) console.log(`${fq}\t${p}`);
    return 0;
  } catch (e: any) {
    console.error(String(e?.message || e));
    return 78;
  }
}

async function maybeHandleWhereMode(
  opts: CliOpts,
  rootCfg: RootConfig,
  rootDir: string,
): Promise<number | null> {
  if (!opts.where) return null;
  const whereRef = opts.where as string;
  let idx: Map<string, string>;
  try {
    idx = await buildIndex(rootDir, rootCfg);
  } catch (e: any) {
    console.error(String(e?.message || e));
    return 78;
  }
  if (!whereRef.includes(".") && !rootCfg.defaultPackage) {
    console.error("jio: config error — bare name requires .jio.defaultPackage");
    return 78;
  }
  const fq = resolveToolRef(whereRef, rootCfg);
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

async function resolveSpecPathOrExit(
  toolRef: string,
  rootCfg: RootConfig,
  rootDir: string,
): Promise<{ index?: Map<string, string>; specPath?: string; code: number | null }> {
  try {
    const index = await buildIndex(rootDir, rootCfg);
    const fqTool = resolveToolRef(toolRef, rootCfg);
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
      return { code: 78 };
    }
    return { index, specPath, code: null };
  } catch (e: any) {
    console.error(String(e?.message || e));
    return { code: 78 };
  }
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

// Shared default limits for execution and sinks
const DEFAULT_LIMITS = {
  maxArgvTokens: 4096,
  maxArgvBytes: 262144,
  maxStdinBytes: 16 * 1024 * 1024,
  maxStdoutJsonBytes: 32 * 1024 * 1024,
  maxNdjsonLineBytes: 1 * 1024 * 1024,
  collectItems: Number.POSITIVE_INFINITY as number,
  collectBytes: Number.POSITIVE_INFINITY as number,
  sinkMaxBytes: 1 * 1024 * 1024,
  sinkMaxItems: 1000,
  sinkMaxRatePerSec: 100,
  sinkWriteTimeoutMs: 500,
  sinkCloseTimeoutMs: 1000,
} as const;

type ValidateFn = ((data: any) => boolean) & { errors?: any };

export function getEffectiveLimits(
  spec: ToolSpec,
  runtime: RunnerRuntimeOptions,
): Required<typeof DEFAULT_LIMITS> {
  return {
    ...DEFAULT_LIMITS,
    ...(spec.command?.limits || {}),
    ...(runtime.limits || {}),
  } as Required<typeof DEFAULT_LIMITS>;
}

export async function resolvePreferredShell(): Promise<string> {
  return (await hasBinaryOnPath("bash")) ? "bash" : "/bin/sh";
}

export function makeShellSetFlags(preferredShell: string): string {
  return preferredShell.includes("bash") ? "set -euo pipefail; " : "set -eu; ";
}

export function buildShellArgsWithScript(preferredShell: string, script: string): string[] {
  const cmd = makeShellSetFlags(preferredShell) + (script || "");
  return preferredShell.includes("bash") ? ["--noprofile", "--norc", "-c", cmd] : ["-c", cmd];
}

export function attachPipeErrorNoops(proc: any) {
  try {
    proc.stdin?.on("error", () => {});
  } catch {}
  try {
    proc.stdout?.on("error", () => {});
  } catch {}
  try {
    proc.stderr?.on("error", () => {});
  } catch {}
}

export function enforceArgvCaps(
  argv: string[],
  limits: Required<typeof DEFAULT_LIMITS>,
): number | null {
  const argvTokenCount = argv.length;
  let argvBytes = 0;
  for (const t of argv) argvBytes += Buffer.byteLength(String(t)) + 1;
  if (argvTokenCount > limits.maxArgvTokens) {
    try {
      process.stderr.write("jio: argv tokens limit exceeded\n");
    } catch {}
    return 78;
  }
  if (argvBytes > limits.maxArgvBytes) {
    try {
      process.stderr.write("jio: argv bytes limit exceeded\n");
    } catch {}
    return 78;
  }
  return null;
}

export async function computeExecCommand(
  initialExecCmd: string,
  initialExecArgv: string[],
  rootDir: string,
): Promise<{ execCmd: string; execArgv: string[] }> {
  let execCmd = initialExecCmd;
  let execArgv = initialExecArgv.slice();

  // Optional secretspec wrapper
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
    try {
      process.stderr.write(
        "jio: warning: secretspec not found on PATH; running without secrets wrap\n",
      );
    } catch {}
  }

  // If executing a TS file directly, run via node with zx-init and type stripping
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

  // Avoid sourcing profiles when executing bash
  if (/(?:^|\/)bash$/.test(execCmd)) {
    execArgv = ["--noprofile", "--norc", ...execArgv];
    const idxC = execArgv.findIndex((a) => a === "-c" || a === "-lc");
    if (idxC >= 0 && idxC === execArgv.length - 1) {
      execArgv.push("cat");
    }
  }

  return { execCmd, execArgv };
}

export async function resolveRoot(): Promise<string> {
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

export async function readRootConfig(rootDir: string): Promise<RootConfig> {
  try {
    const txt = await fsp.readFile(path.join(rootDir, ".jio"), "utf8");
    const obj = JSON.parse(txt);
    try {
      // Validate .jio config shape minimally when configVersion is declared
      if (
        obj &&
        typeof obj === "object" &&
        Object.prototype.hasOwnProperty.call(obj, "configVersion")
      ) {
        const ajv = createAjv();
        const schema = {
          $id: "https://static.kilty.io/jio/config.schema.json",
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          additionalProperties: false,
          properties: {
            configVersion: { type: "string", enum: ["1"] },
            defaultPackage: { type: "string" },
            ignore: { type: "array", items: { type: "string" } },
            globs: { type: "array", items: { type: "string" } },
            excludeGlobs: { type: "array", items: { type: "string" } },
            env: { type: "object", additionalProperties: { type: "string" } },
          },
          required: ["configVersion"],
        } as const;
        const validate = ajv.compile(schema as any);
        const ok = validate(obj);
        if (!ok) {
          const msg = JSON.stringify((validate as any).errors?.[0] || {});
          try {
            process.stderr.write("jio: invalid .jio config: " + msg + "\n");
          } catch {}
        }
      }
    } catch {}
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

export function resolveToolRef(ref: string, cfg: RootConfig): string {
  if (ref.includes(".")) return ref;
  if (!cfg.defaultPackage) return ref; // bare name; no default package known
  return `${cfg.defaultPackage}.${ref}`;
}

export async function buildIndex(rootDir: string, cfg: RootConfig): Promise<Map<string, string>> {
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

let validateFormal: ((data: any) => boolean) | null = null;
function ensureFormalValidator() {
  if (!validateFormal) {
    const { validate } = createAjvValidator();
    validateFormal = validate;
  }
}

export async function readSpec(
  p: string,
): Promise<{ spec: ToolSpec | null; warning: string | null }> {
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

export function buildArgv(spec: ToolSpec, invObj: any): string[] {
  const params = spec.command?.parameters || {};
  const positionals: Array<{ pos: number; tokens: string[] }> = [];
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

    // If JSONPath yields an array for a non-array typed parameter, fail fast.
    if (type !== "array" && Array.isArray(value)) {
      throw new Error(
        `parameter ${paramName} expects type ${type} but JSONPath returned an array; use type=array with collectionStyle or adjust your path`,
      );
    }

    // Enforce kv keys subset of inputSchema.properties when applicable
    if (
      type === "object" &&
      (ps as any).collectionStyle === "kv" &&
      value &&
      typeof value === "object"
    ) {
      const inSchema: any = (spec as any).tool?.inputSchema;
      if (inSchema && (ps as any).path && typeof (ps as any).path === "string") {
        const schemaAt = getSchemaAtPath(inSchema, (ps as any).path as string);
        if (schemaAt && schemaAt.properties && typeof schemaAt.properties === "object") {
          const allowed = new Set<string>(Object.keys(schemaAt.properties));
          const keysAll = Object.keys(value as any);
          const bad = keysAll.filter((k) => !allowed.has(k));
          if (bad.length > 0) {
            throw new Error(`kv keys not allowed for ${(ps as any).path}: ${bad.join(", ")}`);
          }
        }
      }
    }

    const isEmptyArray = type === "array" && Array.isArray(value) && value.length === 0;
    const isEmptyObject =
      type === "object" && value && typeof value === "object" && Object.keys(value).length === 0;
    if (value === undefined || value === null || isEmptyArray || isEmptyObject) {
      if (required) throw new Error(`missing required parameter: ${paramName}`);
      continue;
    }

    if (!flag) {
      const pos = ps.position as number | undefined;
      // Enforce explicit, positive, unique position for positionals
      if (!pos || !Number.isInteger(pos) || pos <= 0) {
        throw new Error(
          `positional parameter '${paramName}' must declare a positive integer position`,
        );
      }
      if (seenPositions.has(pos)) {
        throw new Error(`duplicate positional index ${pos} for parameter '${paramName}'`);
      }
      seenPositions.add(pos);
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
    v = evaluateJsonPathRfc(ps.path as string, invObj);
  } else if (ps.value !== undefined) {
    v = ps.value;
  }
  if ((v === undefined || v === null) && ps.default !== undefined) return ps.default;
  return v;
}

// minimal JSONPath evaluator removed; use tools/jio/jsonpath

// Navigate a JSON Schema object along a simple JSONPath like $.a.b
function getSchemaAtPath(schema: any, jsonPath: string): any | null {
  if (!schema || typeof schema !== "object") return null;
  if (!jsonPath || jsonPath[0] !== "$") return null;
  const parts: string[] = [];
  let i = 1;
  while (i < jsonPath.length) {
    if (jsonPath[i] === ".") {
      i++;
      let start = i;
      while (i < jsonPath.length && /[A-Za-z0-9_]/.test(jsonPath[i])) i++;
      const seg = jsonPath.slice(start, i);
      if (seg) parts.push(seg);
    } else if (jsonPath[i] === "[") {
      // Only support ['prop'] form; ignore other forms
      let start = i;
      while (i < jsonPath.length && jsonPath[i] !== "]") i++;
      if (jsonPath[i] !== "]") break;
      const inner = jsonPath.slice(start + 1, i);
      i++;
      const m = inner.match(/^['"]([^'\\"]+)['"]$/);
      if (m) parts.push(m[1]);
    } else {
      break;
    }
  }
  let cur = schema;
  for (const seg of parts) {
    if (!cur || typeof cur !== "object") return null;
    if (cur.type === "object" && cur.properties && cur.properties[seg]) {
      cur = cur.properties[seg];
      continue;
    }
    // array step
    if (cur.type === "array" && cur.items) {
      cur = cur.items;
      // reprocess seg at this level if array of objects
      if (cur && cur.type === "object" && cur.properties && cur.properties[seg]) {
        cur = cur.properties[seg];
        continue;
      }
    }
    return null;
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
      const valueStyle = (ps as any).flagValueStyle === "separate" ? "separate" : "equals";
      if (valueStyle === "separate") return [flagName, str];
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
        const valueStyle = (ps as any).flagValueStyle === "separate" ? "separate" : "equals";
        if (valueStyle === "separate") return [flagName, joined];
        return [`${flagName}=${joined}`];
      }
      if (style === "repeatFlag") {
        if (!flagName) throw new Error("repeatFlag requires flagName");
        return value.map((v) => `${flagName}=${String(v)}`);
      }
      if (style === "separate") {
        if (!flagName) throw new Error("separate requires flagName");
        const out: string[] = [];
        for (const v of value) {
          out.push(flagName, String(v));
        }
        return out;
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

function handleSchemaPrinting(spec: ToolSpec, argv: string[]): number | null {
  const wantIn = argv.includes("--input-schema");
  const wantOut = argv.includes("--output-schema");
  if (!wantIn && !wantOut) return null;
  if (wantIn && wantOut) {
    if (!spec.tool?.outputSchema) return 65;
    const effIn = spec.tool?.inputSchema || generateInputSchemaFromParameters(spec);
    try {
      process.stdout.write(
        JSON.stringify({ inputSchema: effIn, outputSchema: spec.tool.outputSchema }),
      );
    } catch {}
    return 0;
  }
  if (wantIn) {
    const effIn = spec.tool?.inputSchema || generateInputSchemaFromParameters(spec);
    try {
      process.stdout.write(JSON.stringify(effIn));
    } catch {}
    return 0;
  }
  if (wantOut) {
    if (!spec.tool?.outputSchema) return 65;
    try {
      process.stdout.write(JSON.stringify(spec.tool.outputSchema));
    } catch {}
    return 0;
  }
  return null;
}

export function buildDryRunPlan(
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

async function resolveInvocationObject(
  spec: ToolSpec,
  opts: CliOpts,
): Promise<{ invObj?: any; code?: number }> {
  const requiresInput = usesPathParams(spec);
  let invObj: any = {};
  if (requiresInput || opts.inFile) {
    if (!opts.inFile && requiresInput) {
      console.error("jio: --in is required when required parameters use path");
      return { code: 78 };
    }
    if (opts.inFile) {
      try {
        const txt = await fsp.readFile(path.resolve(opts.inFile), "utf8");
        invObj = JSON.parse(txt);
      } catch (e: any) {
        if (e && e.code === "ENOENT") return { code: 66 };
        return { code: 65 };
      }
    }
  }
  return { invObj };
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

export function buildChildEnv(
  rootCfg: RootConfig,
  spec: ToolSpec,
  runtime: { cleanEnv: boolean; passEnv: string[]; setEnv: Record<string, string> },
): Record<string, string> {
  const base: Record<string, string> = {};
  const mustKeep = new Set<string>([
    "PATH",
    "WORKSPACE_ROOT",
    "NODE_BIN",
    "NODE_OPTIONS",
    "NODE_PATH",
    "HOME",
    "TMPDIR",
    "TEMP",
    "TMP",
    // Common locale and tooling defaults often required by child processes
    "LANG",
    "LC_ALL",
    // Common SSL and SSH tooling
    "SSL_CERT_FILE",
    "GIT_SSH_COMMAND",
    "SSH_AUTH_SOCK",
  ]);
  if (!runtime.cleanEnv) {
    for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") base[k] = v;
  } else {
    for (const k of mustKeep) {
      const v = process.env[k];
      if (typeof v === "string") base[k] = v;
    }
    for (const name of spec.command?.envPassthrough || []) {
      const v = process.env[name];
      if (typeof v === "string") base[name] = v;
    }
    // Support exact and glob-style passEnv entries (e.g., AWS_*, GCP_*)
    const patterns = Array.isArray(runtime.passEnv) ? runtime.passEnv : [];
    const envKeys = Object.keys(process.env);
    for (const pat of patterns) {
      const hasWildcard = /[\*\?]/.test(pat);
      if (!hasWildcard) {
        const v = process.env[pat];
        if (typeof v === "string") base[pat] = v;
        continue;
      }
      // Convert simple glob to RegExp: * -> .* and ? -> .
      const reSrc =
        "^" +
        pat
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\\\*/g, ".*")
          .replace(/\\\?/g, ".") +
        "$";
      let re: RegExp | null = null;
      try {
        re = new RegExp(reSrc);
      } catch {
        re = null;
      }
      if (!re) continue;
      for (const k of envKeys) {
        if (re.test(k)) {
          const v = process.env[k];
          if (typeof v === "string") base[k] = v;
        }
      }
    }
  }
  // Root config/env and spec.env overlay
  for (const [k, v] of Object.entries(rootCfg.env || {})) base[k] = v;
  for (const [k, v] of Object.entries(spec.command?.env || {})) base[k] = v;
  for (const [k, v] of Object.entries(runtime.setEnv || {})) base[k] = v;
  return base;
}

function globToRegExp(glob: string): RegExp {
  // very small glob: **, *, and literal dots/slashes
  let g = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  g = g.replace(/\\\\/g, "/");
  g = g.replace(/\*\*/g, ".*?");
  g = g.replace(/\*/g, "[^/]*?");
  return new RegExp("^" + g + "$");
}

type RunnerRuntimeOptions = {
  collect: boolean;
  collectLimit?: number;
  limits?: {
    maxArgvTokens?: number;
    maxArgvBytes?: number;
    maxStdinBytes?: number;
    maxStdoutJsonBytes?: number;
    maxNdjsonLineBytes?: number;
    collectItems?: number;
    collectBytes?: number;
  };
  timeoutMsOverride?: number;
  cleanEnv: boolean;
  passEnv: string[];
  setEnv: Record<string, string>;
  stdoutTarget?: NodeJS.WritableStream;
  stderrTarget?: NodeJS.WritableStream;
  inputSource?: NodeJS.ReadableStream;
  // PR3.2: optional cancellation and progress hooks
  isCancelled?: () => boolean;
  onProgress?: (info: {
    items?: number;
    bytes?: number;
    message?: string;
    progress?: number;
  }) => void;
};

export async function runWithTransforms(
  rootDir: string,
  specPath: string,
  spec: ToolSpec,
  argv: string[],
  rootCfg: RootConfig,
  invObj: any,
  runtime: RunnerRuntimeOptions,
): Promise<number> {
  // Structured diagnostics (JSON lines to stderr)
  const logEvent = (evt: any, force = false) => {
    try {
      if (force || process.env.JIO_DEBUG === "1" || process.env.TEST_CAPTURE_LOGS === "1") {
        const obj = { ts: Date.now(), ...evt };
        ((runtime as any).stderrTarget || process.stderr).write(JSON.stringify(obj) + "\n");
      }
    } catch {}
  };
  let didLogSigterm = false;

  // Descendant-only termination with platform ps fallback
  async function listDescendantPids(rootPids: number[]): Promise<Set<number>> {
    try {
      const args = process.platform === "darwin" ? ["-Ao", "pid,ppid"] : ["-eo", "pid,ppid"];
      const ps = spawn("ps", args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      ps.stdout.on("data", (b: any) => (out += Buffer.from(b).toString("utf8")));
      await new Promise<void>((res) => ps.on("close", () => res()));
      const edges = new Map<number, number[]>();
      for (const line of out.split(/\r?\n/)) {
        const m = line.trim().match(/^(\d+)\s+(\d+)$/);
        if (!m) continue;
        const pid = Number(m[1]);
        const ppid = Number(m[2]);
        if (!edges.has(ppid)) edges.set(ppid, []);
        (edges.get(ppid) as number[]).push(pid);
      }
      const roots = new Set<number>(rootPids.filter((n) => Number.isFinite(n) && n > 0));
      const visited = new Set<number>();
      const queue: number[] = Array.from(roots);
      while (queue.length) {
        const cur = queue.shift() as number;
        if (visited.has(cur)) continue;
        visited.add(cur);
        const kids = edges.get(cur) || [];
        for (const k of kids) queue.push(k);
      }
      return visited;
    } catch {
      return new Set<number>();
    }
  }

  function terminateProcs(procs: any[]) {
    (async () => {
      const roots = (procs || [])
        .map((p: any) => (p && p.pid ? Number(p.pid) : 0))
        .filter((n: number) => n > 0);
      let targets = await listDescendantPids(roots);
      const useFallback = targets.size === 0;
      if (useFallback) {
        // Fallback to group kill behavior per original implementation
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
      } else {
        // Target descendants only
        for (const pid of targets) {
          try {
            process.kill(pid, "SIGTERM");
          } catch {}
        }
      }
      if (!didLogSigterm) {
        try {
          ((runtime as any).stderrTarget || process.stderr).write(
            "jio: timeout — sent SIGTERM to process groups; will SIGKILL after 5s\n",
          );
        } catch {}
        didLogSigterm = true;
      }
      logEvent(
        {
          event: "terminate",
          reason: "timeout",
          strategy: useFallback ? "group" : "descendants",
          pids: useFallback ? roots : Array.from(targets),
        },
        true,
      );
      setTimeout(async () => {
        try {
          if (useFallback) {
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
          } else {
            // Second descendant scan before SIGKILL
            try {
              targets = await listDescendantPids(roots);
            } catch {}
            for (const pid of targets) {
              try {
                process.kill(pid, "SIGKILL");
              } catch {}
            }
          }
          logEvent({ event: "terminated", signal: "SIGKILL" }, true);
        } catch {}
      }, 5000);
    })().catch(() => undefined);
  }
  const limits = getEffectiveLimits(spec, runtime);
  const cwd = resolveWorkingDir(rootDir, specPath, spec);
  const env = buildChildEnv(rootCfg, spec, runtime);
  // Preserve user-provided debug opts; do not mutate global env here.
  const sink = openFailureSink(rootDir, specPath, spec, rootCfg, runtime);

  // Enforce argv caps before spawn
  {
    const capCode = enforceArgvCaps(argv, limits);
    if (capCode !== null) return capCode;
  }

  // Optional stdinTransform
  const stIn = spec.command?.stdinTransform;
  const preferredShell = await resolvePreferredShell();
  const shellArgsIn = buildShellArgsWithScript(preferredShell, stIn?.shell || "");
  const p1 =
    stIn && stIn.shell
      ? spawn(preferredShell, shellArgsIn, {
          cwd,
          env,
          stdio: ["pipe", "pipe", "pipe"],
          detached: true,
        })
      : null;
  // Swallow pipe errors from transform during teardown
  if (p1) attachPipeErrorNoops(p1);
  const p1StdoutEnd: Promise<void> = p1
    ? new Promise<void>((res) => {
        try {
          p1.stdout.on("end", () => res());
        } catch {
          res();
        }
      })
    : Promise.resolve();

  // Determine exec command; auto-wrap and normalize argv
  const { execCmd, execArgv } = await computeExecCommand(
    spec.command!.exec as string,
    argv,
    rootDir,
  );

  const cmd = spawn(execCmd, execArgv, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    // Make exec the leader of its own process group so we can signal the whole tree reliably
    detached: true,
  });
  // Swallow pipe errors from main exec during teardown (e.g., EPIPE after SIGTERM)
  attachPipeErrorNoops(cmd);

  const st = spec.command?.stdoutTransform;

  const p2: any =
    st && st.shell && st.format
      ? (() => {
          const shellArgsOut = buildShellArgsWithScript(preferredShell, st.shell);
          const proc = spawn(preferredShell, shellArgsOut, {
            cwd,
            env,
            stdio: ["pipe", "pipe", "pipe"],
            detached: true,
          });
          attachPipeErrorNoops(proc);
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
  // Exclude failure sink from termination group to allow it to flush after endInput()
  const procs = [p1, cmd, p2].filter(Boolean) as any[];
  const mgr = new ProcessGroupManager();
  mgr.register(procs, sink);
  setCurrentManager(mgr);
  // If stdin parsing fails, terminate once without polling
  let abortSent = false;
  const abortOnce = () => {
    if (abortSent) return;
    abortSent = true;
    try {
      terminateGroup(procs);
    } catch {}
  };
  const timeoutMs = runtime.timeoutMsOverride || spec.command?.timeoutMs;
  let localTimedOut = false;
  let localKiller: NodeJS.Timeout | null = null;
  // PR3.2: external cancellation support
  let localCancelled = false;
  let cancelPoll: NodeJS.Timeout | null = null;
  if (typeof (runtime as any).isCancelled === "function") {
    cancelPoll = setInterval(() => {
      try {
        if (!localCancelled && (runtime as any).isCancelled && (runtime as any).isCancelled()) {
          localCancelled = true;
          try {
            (sink as any)?.endInput?.();
          } catch {}
          terminateProcs(procs);
        }
      } catch {}
    }, 50);
  }
  const localTimeoutPromise: Promise<"TIMEOUT"> | null =
    timeoutMs && timeoutMs > 0
      ? new Promise<"TIMEOUT">((res) => {
          localKiller = setTimeout(() => {
            try {
              (sink as any)?.endInput?.();
            } catch {}
            terminateProcs(procs);
            // Human-readable timeout note once
            if (!didLogSigterm) {
              try {
                ((runtime as any).stderrTarget || process.stderr).write(
                  "jio: timeout — sent SIGTERM to process groups; will SIGKILL after 5s\n",
                );
              } catch {}
              didLogSigterm = true;
            }
            try {
              // Proactively break any readers waiting on stdout/stdin streams to avoid hangs
              (p2 as any)?.stdout?.destroy();
            } catch {}
            try {
              (p2 as any)?.stdin?.destroy?.();
            } catch {}
            try {
              cmd.stdout?.destroy?.();
            } catch {}
            try {
              cmd.stdin?.destroy?.();
            } catch {}
            try {
              (p1 as any)?.stdout?.destroy?.();
            } catch {}
            localTimedOut = true;
            res("TIMEOUT");
          }, timeoutMs);
        })
      : null;

  // Wire stderr passthrough for visibility
  if (p1) p1.stderr.pipe(process.stderr, { end: false });
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
  let stdinLimitExceeded = false;
  let stdinConfigError = false;
  let stdinForwardDone: Promise<void> | null = null;
  const waitDrain = async (w: NodeJS.WritableStream) =>
    new Promise<void>((res) => w.once("drain", res));
  if (!p1) {
    // No transform: pipe stdin directly with backpressure and limits
    try {
      // Use highWaterMark tuned for large inputs to avoid tiny chunking overheads
      const limiter = new PassThrough({ highWaterMark: 256 * 1024 });
      let stdinCount = 0;
      limiter.on("data", (chunk) => {
        stdinCount += (chunk as Buffer).length;
        if (stdinCount > limits.maxStdinBytes) {
          try {
            process.stderr.write("jio: stdin bytes limit exceeded\n");
          } catch {}
          try {
            limiter.destroy();
          } catch {}
          try {
            cmd.stdin.end();
          } catch {}
          stdinLimitExceeded = true;
        }
      });
      // Stream piping honors backpressure internally; do not block the main flow
      (runtime.inputSource || process.stdin).pipe(limiter).pipe(cmd.stdin);
      // If shell pipeline upstream ends early (e.g., `cat file | head -n1 | jio ...`),
      // end our stdin too so the child can complete and emit output
      limiter.once("end", () => {
        try {
          cmd.stdin.end();
        } catch {}
      });
      try {
        process.stdin.on("error", () => {});
      } catch {}
    } catch {}
  } else {
    // process.stdin -> p1.stdin
    const limiter = new PassThrough();
    let stdinCount = 0;
    limiter.on("data", (chunk) => {
      stdinCount += (chunk as Buffer).length;
      if (stdinCount > limits.maxStdinBytes) {
        try {
          const tag = stIn!.format === "json" ? " (json)" : "";
          process.stderr.write("jio: stdin bytes limit exceeded" + tag + "\n");
        } catch {}
        try {
          limiter.destroy();
        } catch {}
        try {
          p1.stdin.end();
        } catch {}
        stdinLimitExceeded = true;
      }
    });
    (runtime.inputSource || process.stdin).pipe(limiter).pipe(p1.stdin);
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
            abortOnce();
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
        let total = 0;
        for await (const chunk of p1.stdout) {
          const c = Buffer.from(chunk);
          total += c.length;
          if (total > limits.maxStdinBytes) {
            try {
              process.stderr.write("jio: stdin bytes limit exceeded (json)\n");
            } catch {}
            try {
              (p1 as any)?.stdout?.destroy?.();
            } catch {}
            try {
              cmd.stdin.end();
            } catch {}
            stdinLimitExceeded = true;
            return;
          }
          chunks.push(c);
        }
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
          abortOnce();
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
  const ajv = createAjv();
  const schema = spec.tool?.outputSchema;
  const validate: ValidateFn | null = schema ? (ajv.compile(schema) as any) : null;

  let exitCode = 0;
  let stdoutParseFailed = false;
  let stdoutConfigError = false;
  // Helper to gracefully finalize the failure sink with a bounded, idempotent shutdown
  let sinkFinalized = false;
  const finalizeFailureSink = async () => {
    if (sinkFinalized) return;
    sinkFinalized = true;
    if (!sink) return;
    try {
      (sink as any).endInput?.();
    } catch {}
    const closePromise = (sink as any).close?.() as Promise<void> | undefined;
    if (closePromise && typeof closePromise.then === "function") {
      await Promise.race([closePromise, new Promise<void>((res) => setTimeout(res, 1000))]);
    }
  };
  if (st && st.format === "ndjson") {
    const result = await handleStdoutNdjson({
      p2,
      limits,
      validate,
      runtime,
      sink,
      finalizeFailureSink,
      localTimedOut,
      isCancelled: () =>
        localCancelled || ((runtime as any).isCancelled ? !!(runtime as any).isCancelled() : false),
    });
    if (typeof result === "number") return result;
  } else if (st && st.format === "json") {
    const result = await handleStdoutJson({
      p2,
      limits,
      validate,
      runtime,
      sink,
      finalizeFailureSink,
      localTimedOut,
      isCancelled: () =>
        localCancelled || ((runtime as any).isCancelled ? !!(runtime as any).isCancelled() : false),
      markStdoutParseFailed: () => {
        stdoutParseFailed = true;
      },
    });
    if (typeof result === "number") return result;
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

  // If we already know we must fail due to parse/config errors, stop early
  // Ensure stdin forwarding finished so parse-failure flag is up-to-date before deciding
  try {
    if (stdinForwardDone) await stdinForwardDone;
  } catch {}
  if (stdinParseFailed) {
    terminateProcs([p1, cmd, p2].filter(Boolean) as any[]);
    await finalizeFailureSink();
    try {
      if (localKiller) clearTimeout(localKiller);
    } catch {}
    try {
      process.stderr.write("stage failed: stdinTransform code=65\n");
    } catch {}
    try {
      mgr.clear();
      setCurrentManager(null);
    } catch {}
    return 65;
  }
  if (stdoutParseFailed) {
    terminateProcs([p1, cmd, p2].filter(Boolean) as any[]);
    await finalizeFailureSink();
    try {
      if (localKiller) clearTimeout(localKiller);
    } catch {}
    try {
      process.stderr.write("stage failed: stdoutTransform code=65\n");
    } catch {}
    try {
      mgr.clear();
      setCurrentManager(null);
    } catch {}
    return 65;
  }

  // Wait for stages and timeout race
  const allWait = Promise.all([cmdWaitEarly, p1WaitBaseEarly, p2WaitEarly]);
  const completedByTimeout = localTimeoutPromise
    ? (await Promise.race([allWait, localTimeoutPromise])) === "TIMEOUT"
    : false;
  const [cCode, p1Code, p2Code] = completedByTimeout
    ? [0, 0, 0]
    : await Promise.all([cmdWaitEarly, p1WaitBaseEarly, p2WaitEarly]);
  // If we timed out and have a failure sink, request close but do not block here;
  // we'll perform bounded finalize during exit code computation.
  if (completedByTimeout && sink) {
    try {
      (sink as any).endInput?.();
    } catch {}
  }
  try {
    if (localKiller) clearTimeout(localKiller);
  } catch {}

  // Compute exit code precedence
  if (stdinLimitExceeded) {
    await finalizeFailureSink();
    return 78;
  }
  if (stdinConfigError || stdoutConfigError) {
    await finalizeFailureSink();
    return 78;
  }
  if (runtime.collect && typeof runtime.collectLimit === "number" && runtime.collectLimit >= 0) {
    // If limit exceeded flag set earlier
    // Use a weak signal: check stderr wrote message is optional; return 78 to indicate config error
    // (limitExceeded variable is scoped above; redeclare here to satisfy TS)
  }
  if (localTimedOut) {
    // Ensure failure sink has a chance to flush before we exit
    await finalizeFailureSink();
    return 124;
  }
  // (Parse failures are handled above with early return)
  await finalizeFailureSink();
  try {
    mgr.clear();
    setCurrentManager(null);
  } catch {}
  try {
    if (cancelPoll) clearInterval(cancelPoll);
  } catch {}
  return exitCode || cCode || p1Code || p2Code;
}

type HandleNdjsonArgs = {
  p2: any;
  limits: Required<typeof DEFAULT_LIMITS>;
  validate: ValidateFn | null;
  runtime: RunnerRuntimeOptions;
  sink: any;
  finalizeFailureSink: () => Promise<void>;
  localTimedOut: boolean;
  isCancelled: () => boolean;
};

async function handleStdoutNdjson(args: HandleNdjsonArgs): Promise<number | void> {
  const { p2, limits, validate, runtime, sink, finalizeFailureSink, localTimedOut, isCancelled } =
    args;
  let buffer = "";
  let sawFirstLine = false;
  let arrayStarted = false;
  let itemsEmitted = 0;
  let bytesCollected = 0;
  let collectLimitExceeded = false;
  let suppressFurther = false;

  for await (const chunk of p2.stdout) {
    buffer += Buffer.from(chunk).toString("utf8");
    if (buffer.indexOf("\n") < 0 && Buffer.byteLength(buffer) > limits.maxNdjsonLineBytes) {
      process.stderr.write("jio: ndjson line bytes limit exceeded (stream)\n");
      await finalizeFailureSink();
      return 78;
    }
    if (isCancelled()) {
      await finalizeFailureSink();
      return 124;
    }
    while (true) {
      const nl = buffer.indexOf("\n");
      if (nl < 0) break;
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const cap = enforceNdjsonLineCap(line, limits.maxNdjsonLineBytes);
      if (cap !== null) {
        await finalizeFailureSink();
        return cap;
      }
      if (
        !emitNdjsonLine({
          line,
          sawFirstLineRef: () => sawFirstLine,
          setSawFirstLine: () => (sawFirstLine = true),
          validate,
          runtime,
          collectState: {
            arrayStartedRef: () => arrayStarted,
            startArray: () => {
              ((runtime as any).stdoutTarget || process.stdout).write("[");
              arrayStarted = true;
            },
            itemsEmittedRef: () => itemsEmitted,
            incrementItems: (n) => (itemsEmitted += n),
            bytesCollectedRef: () => bytesCollected,
            addCollectedBytes: (n) => (bytesCollected += n),
            suppressFurtherRef: () => suppressFurther,
            suppressFurther: () => (suppressFurther = true),
            setCollectLimitExceeded: () => (collectLimitExceeded = true),
            limits,
          },
          sink,
        })
      ) {
        // tolerated invalid line
      }
      try {
        if ((runtime as any).onProgress)
          (runtime as any).onProgress({
            items: itemsEmitted,
            bytes: bytesCollected,
            message: "processing",
          });
      } catch {}
      if (isCancelled()) {
        await finalizeFailureSink();
        return 124;
      }
    }
    if (localTimedOut) {
      await finalizeFailureSink();
      return 124;
    }
  }
  if (localTimedOut) {
    await finalizeFailureSink();
    return 124;
  }
  if (isCancelled()) {
    await finalizeFailureSink();
    return 124;
  }
  const trailing = buffer.trim();
  if (trailing) {
    if (Buffer.byteLength(trailing) > limits.maxNdjsonLineBytes) {
      process.stderr.write("jio: ndjson line bytes limit exceeded (trailing)\n");
      await finalizeFailureSink();
      return 78;
    }
    let s = buffer;
    if (!sawFirstLine && s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    if (s.endsWith("\r")) s = s.slice(0, -1);
    try {
      const obj = JSON.parse(s);
      if (validate && !validate(obj)) {
        const msg = JSON.stringify(validate.errors?.[0] || {});
        process.stderr.write(`jio: invalid output item: ${msg}\n`);
        if (sink) await sink.write({ reason: "output", object: obj, message: msg });
      } else {
        if (runtime.collect) {
          if (!suppressFurther) {
            const res = tryCollectItem({
              obj,
              collectState: {
                arrayStartedRef: () => arrayStarted,
                startArray: () => {
                  ((runtime as any).stdoutTarget || process.stdout).write("[");
                  arrayStarted = true;
                },
                itemsEmittedRef: () => itemsEmitted,
                incrementItems: (n) => (itemsEmitted += n),
                bytesCollectedRef: () => bytesCollected,
                addCollectedBytes: (n) => (bytesCollected += n),
                suppressFurtherRef: () => suppressFurther,
                suppressFurther: () => (suppressFurther = true),
                setCollectLimitExceeded: () => (collectLimitExceeded = true),
                limits,
              },
              write: (t: string) => ((runtime as any).stdoutTarget || process.stdout).write(t),
            });
            if (!res) {
              // limits exceeded inside tryCollectItem
            }
          }
        } else {
          ((runtime as any).stdoutTarget || process.stdout).write(s + "\n");
        }
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
  if (runtime.collect && arrayStarted) {
    ((runtime as any).stdoutTarget || process.stdout).write("]\n");
  }
  if (runtime.collect && collectLimitExceeded) {
    const hintItems =
      typeof runtime.collectLimit === "number" && runtime.collectLimit >= 0
        ? ` --collect-limit=${String(runtime.collectLimit)}`
        : " (set --collect-limit to increase)";
    const hintBytes = Number.isFinite(limits.collectBytes as number)
      ? ` --collect-bytes=${String(limits.collectBytes)}`
      : " (set --collect-bytes to increase)";
    process.stderr.write(`jio: collect limit exceeded.${hintItems}${hintBytes}\n`);
    return 78;
  }
}

function enforceNdjsonLineCap(line: string, maxBytes: number): number | null {
  if (Buffer.byteLength(line) > maxBytes) {
    process.stderr.write("jio: ndjson line bytes limit exceeded\n");
    return 78;
  }
  return null;
}

type CollectState = {
  arrayStartedRef: () => boolean;
  startArray: () => void;
  itemsEmittedRef: () => number;
  incrementItems: (n: number) => void;
  bytesCollectedRef: () => number;
  addCollectedBytes: (n: number) => void;
  suppressFurtherRef: () => boolean;
  suppressFurther: () => void;
  setCollectLimitExceeded: () => void;
  limits: Required<typeof DEFAULT_LIMITS>;
};

function tryCollectItem(args: {
  obj: any;
  collectState: CollectState;
  write: (s: string) => void;
}): boolean {
  const { obj, collectState: s, write } = args;
  const itemStr = JSON.stringify(obj);
  const itemBytes = Buffer.byteLength(itemStr);
  const haveByteCap = Number.isFinite(s.limits.collectBytes as number);
  if (haveByteCap && s.bytesCollectedRef() + itemBytes > (s.limits.collectBytes as number)) {
    s.setCollectLimitExceeded();
    s.suppressFurther();
    return false;
  }
  if (!s.arrayStartedRef()) s.startArray();
  else write(",");
  write(itemStr);
  s.incrementItems(1);
  s.addCollectedBytes(itemBytes);
  return true;
}

function emitNdjsonLine(args: {
  line: string;
  sawFirstLineRef: () => boolean;
  setSawFirstLine: () => void;
  validate: ValidateFn | null;
  runtime: RunnerRuntimeOptions;
  collectState: CollectState;
  sink: any;
}): boolean {
  let s = String(args.line);
  if (s.trim() === "") return true;
  if (!args.sawFirstLineRef()) {
    args.setSawFirstLine();
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  }
  if (s.endsWith("\r")) s = s.slice(0, -1);
  try {
    const obj = JSON.parse(s);
    if (args.validate && !args.validate(obj)) {
      const msg = JSON.stringify(args.validate.errors?.[0] || {});
      process.stderr.write(`jio: invalid output item: ${msg}\n`);
      if (args.sink) args.sink.write({ reason: "output", object: obj, message: msg });
      return true;
    }
    if (args.runtime.collect) {
      if (args.collectState.suppressFurtherRef()) return true;
      if (
        typeof args.runtime.collectLimit === "number" &&
        args.runtime.collectLimit >= 0 &&
        (args.collectState.itemsEmittedRef() >= args.runtime.collectLimit ||
          (args.collectState.limits.collectItems as number) <= args.collectState.itemsEmittedRef())
      ) {
        args.collectState.setCollectLimitExceeded();
        args.collectState.suppressFurther();
        return true;
      }
      tryCollectItem({
        obj,
        collectState: args.collectState,
        write: (t: string) => ((args.runtime as any).stdoutTarget || process.stdout).write(t),
      });
      return true;
    }
    ((args.runtime as any).stdoutTarget || process.stdout).write(s + "\n");
    return true;
  } catch {
    process.stderr.write("jio: invalid NDJSON line (not JSON)\n");
    if (args.sink)
      args.sink.write({
        reason: "stdout",
        object: s.slice(0, 200),
        message: "invalid NDJSON",
      });
    return false;
  }
}

async function handleStdoutJson(args: {
  p2: any;
  limits: Required<typeof DEFAULT_LIMITS>;
  validate: ValidateFn | null;
  runtime?: RunnerRuntimeOptions;
  sink: any;
  finalizeFailureSink: () => Promise<void>;
  localTimedOut: boolean;
  isCancelled: () => boolean;
  markStdoutParseFailed: () => void;
}): Promise<number | void> {
  const {
    p2,
    limits,
    validate,
    runtime,
    sink,
    finalizeFailureSink,
    localTimedOut,
    isCancelled,
    markStdoutParseFailed,
  } = args;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of p2.stdout) {
    if (isCancelled()) {
      try {
        (p2 as any)?.stdout?.destroy?.();
      } catch {}
      await finalizeFailureSink();
      return 124;
    }
    if (localTimedOut) {
      try {
        (p2 as any)?.stdout?.destroy?.();
      } catch {}

      await finalizeFailureSink();
      return 124;
    }
    const c = Buffer.from(chunk);
    total += c.length;
    if (total > limits.maxStdoutJsonBytes) {
      process.stderr.write("jio: stdout JSON bytes limit exceeded\n");
      await finalizeFailureSink();
      return 78;
    }
    chunks.push(c);
  }
  let buf = Buffer.concat(chunks).toString("utf8");
  if (buf.charCodeAt(0) === 0xfeff) buf = buf.slice(1);
  try {
    const obj = JSON.parse(buf);
    if (validate && !validate(obj)) {
      const msg = JSON.stringify(validate.errors?.[0] || {});
      process.stderr.write(`jio: invalid output: ${msg}\n`);
      if (sink) await sink.write({ reason: "output", object: obj, message: msg });
      markStdoutParseFailed();
      return; // allow precedence handler to return 65 later
    }
    ((args.runtime as any).stdoutTarget || process.stdout).write(JSON.stringify(obj));
  } catch {
    process.stderr.write("jio: invalid JSON output\n");
    if (sink)
      await sink.write({
        reason: "stdout",
        object: buf.slice(0, 200),
        message: "invalid JSON document",
      });
    markStdoutParseFailed();
    return; // allow precedence handler to return 65 later
  }
}

export function openFailureSink(
  rootDir: string,
  specPath: string,
  spec: ToolSpec,
  rootCfg: RootConfig,
  runtime?: RunnerRuntimeOptions,
): {
  write: (obj: any) => Promise<void>;
  close: () => Promise<void>;
  proc: any;
  endInput: () => void;
} | null {
  const of = spec.command?.onValidationFailure;
  if (!of || !of.shell) return null;
  const cwd = resolveWorkingDir(rootDir, specPath, spec);
  const env = runtime
    ? buildChildEnv(rootCfg, spec, {
        cleanEnv: !!runtime.cleanEnv,
        passEnv: runtime.passEnv || [],
        setEnv: runtime.setEnv || {},
      })
    : mergeEnv(rootCfg, spec);
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
  try {
    p.stdin.on("error", (e: any) => {
      if (e && e.code === "EPIPE") {
        // treat as closed; subsequent writes will be no-ops
      }
    });
  } catch {}
  let writeChain: Promise<void> = Promise.resolve();
  // Caps and rate limiting
  const limits = spec.command?.limits || {};
  const sinkMaxBytes = Number.isFinite(limits.sinkMaxBytes as number)
    ? (limits.sinkMaxBytes as number)
    : 1 * 1024 * 1024;
  const sinkMaxItems = Number.isFinite(limits.sinkMaxItems as number)
    ? (limits.sinkMaxItems as number)
    : 1000;
  const sinkMaxRatePerSec = Number.isFinite(limits.sinkMaxRatePerSec as number)
    ? (limits.sinkMaxRatePerSec as number)
    : 100;
  const sinkWriteTimeoutMs = Number.isFinite(limits.sinkWriteTimeoutMs as number)
    ? (limits.sinkWriteTimeoutMs as number)
    : 500;
  const sinkCloseTimeoutMs = Number.isFinite(limits.sinkCloseTimeoutMs as number)
    ? (limits.sinkCloseTimeoutMs as number)
    : 1000;
  let bytesWritten = 0;
  let itemsWritten = 0;
  let rateWindowStart = Date.now();
  let rateCount = 0;
  let sentLimitMsg = false;
  let sentRateMsg = false;
  let droppedForRate = 0;
  let droppedForCaps = 0;
  const write = async (obj: any) => {
    writeChain = writeChain.then(async () => {
      try {
        // Enforce size caps
        let payload = obj;
        try {
          if (typeof obj === "object" && obj) {
            const s = JSON.stringify(obj);
            if (Buffer.byteLength(s) > 8 * 1024) {
              payload = {
                ...obj,
                message: String(obj.message || "").slice(0, 7900) + "…(truncated)",
              };
            }
          }
        } catch {}
        const line = JSON.stringify(payload) + "\n";
        const now = Date.now();
        if (now - rateWindowStart >= 1000) {
          rateWindowStart = now;
          rateCount = 0;
        }
        if (rateCount >= sinkMaxRatePerSec) {
          droppedForRate++;
          if (!sentRateMsg) {
            try {
              process.stderr.write(
                "jio: sink limits reached (hint: command.limits.sinkMax* / sinkMaxRatePerSec)\n",
              );
            } catch {}
            sentRateMsg = true;
          }
          return; // drop due to rate
        }
        if (itemsWritten >= sinkMaxItems || bytesWritten + Buffer.byteLength(line) > sinkMaxBytes) {
          droppedForCaps++;
          if (!sentLimitMsg) {
            try {
              process.stderr.write(
                "jio: sink limits reached (hint: command.limits.sinkMax* / sinkMaxRatePerSec)\n",
              );
            } catch {}
            sentLimitMsg = true;
          }
          return; // drop due to caps
        }
        rateCount++;
        itemsWritten++;
        bytesWritten += Buffer.byteLength(line);
        const ok = p.stdin.write(line);
        if (!ok) {
          await Promise.race([
            new Promise<void>((res) => p.stdin.once("drain", res)),
            new Promise<void>((res) => p.stdin.once("close", res)),
            new Promise<void>((res) => p.stdin.once("finish", res)),
            new Promise<void>((res) => p.stdin.once("end", res)),
            new Promise<void>((res) => p.stdin.once("error", () => res())),
            new Promise<void>((res) => setTimeout(res, sinkWriteTimeoutMs)),
          ]);
        }
      } catch {}
    });
    await writeChain.catch(() => undefined);
  };
  const endInput = () => {
    try {
      p.stdin.end();
    } catch {}
  };
  const close = async () => {
    try {
      await writeChain.catch(() => undefined);
    } catch {}
    endInput();
    await Promise.race([
      new Promise<void>((res) => p.on("exit", () => res())),
      new Promise<void>((res) => setTimeout(res, sinkCloseTimeoutMs)),
    ]).catch(() => undefined);
    if (process.env.JIO_SINK_DEBUG === "1") {
      try {
        process.stderr.write(
          `jio: sink summary drops: rate=${droppedForRate} caps=${droppedForCaps} written_items=${itemsWritten} written_bytes=${bytesWritten}\n`,
        );
      } catch {}
    }
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
    const candidate = path.join(dir, bin);
    try {
      const st = await fsp.stat(candidate);
      if (!st.isFile()) continue;
      await fsp.access(candidate, (fs as any).constants?.X_OK ?? 1);
      return true;
    } catch {}
  }
  return false;
}

export async function findToolSpecs(
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

export function waitProcess(
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
// Run CLI only when this module is the entrypoint (not when imported)
(() => {
  try {
    const candidate = "file://" + path.resolve(process.argv[1] || "");
    const isEntrypoint =
      typeof (import.meta as any).url === "string" && (import.meta as any).url === candidate;
    if (!isEntrypoint) return;
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
  } catch {
    // If detection fails, do nothing (module likely imported)
  }
})();
