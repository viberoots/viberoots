#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type JioCallOptions = {
  output: "json" | "ndjson";
  collect?: boolean; // when output=ndjson, collect into array (default true)
  passEnv?: string[]; // names to pass through
  env?: Record<string, string>; // extra env for the child
  timeoutMs?: number;
  args?: string[]; // extra CLI args
  cwd?: string; // working directory
};

/**
 * Call a jio tool ergonomically: object in -> object (or array) out.
 * - Writes input JSON to a temp file and passes it via --in, so it works with param mapping specs.
 * - For NDJSON tools, defaults to returning an array (adds --collect). Set collect=false to get raw lines array anyway.
 */
export async function jioCall<TInput = unknown, TOut = unknown>(
  fqName: string,
  input?: TInput,
  options?: JioCallOptions,
): Promise<TOut | TOut[]> {
  const opts: JioCallOptions = {
    output: options?.output ?? "json",
    collect: options?.collect ?? true,
    passEnv: options?.passEnv ?? [],
    env: options?.env ?? {},
    timeoutMs: options?.timeoutMs,
    args: options?.args ?? [],
    cwd: options?.cwd,
  };

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "jio-call-"));
  const inPath = path.join(tmpDir, "in.json");
  try {
    if (input !== undefined) {
      await fsp.writeFile(inPath, JSON.stringify(input), "utf8");
    }

    const cliArgs: string[] = ["jio", fqName];
    if (input !== undefined) cliArgs.push(`--in=${inPath}`);
    if (opts.output === "ndjson" && opts.collect) cliArgs.push("--collect");
    if (typeof opts.timeoutMs === "number") cliArgs.push("--timeout-ms", String(opts.timeoutMs));
    for (const name of opts.passEnv || []) cliArgs.push("--pass-env", name);
    if (opts.args && opts.args.length) cliArgs.push(...opts.args);

    const execEnv: Record<string, string> = { ...(process.env as any) } as any;
    for (const [k, v] of Object.entries(opts.env || {})) execEnv[k] = v;

    const res = await $({
      stdio: "pipe",
      cwd: opts.cwd,
      env: execEnv,
    })`bash --noprofile --norc -lc ${cliArgs.join(" ")}`;
    const stdout = String(res.stdout || "");
    if (opts.output === "json") {
      return JSON.parse(stdout) as TOut;
    }
    // ndjson: collect into array (one JSON per line)
    const out: TOut[] = [] as any;
    for (const line of stdout.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      try {
        out.push(JSON.parse(s));
      } catch {
        // tolerate non-JSON lines in NDJSON stream (should be rare)
      }
    }
    return out;
  } catch (e: any) {
    // Surface stderr for easier debugging
    const errOut = String(e?.stderr || e?.stdout || e || "");
    throw new Error(errOut);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
