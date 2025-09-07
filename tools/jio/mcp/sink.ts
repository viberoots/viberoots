import { spawn } from "node:child_process";
import path from "node:path";
import { buildChildEnv } from "../runner.ts";

export interface FailureSink {
  write: (obj: any) => Promise<void>;
  close: () => Promise<void>;
  endInput: () => void;
  proc?: any;
}

export interface FailureSinkFactoryArgs {
  rootDir: string;
  specPath: string;
  spec: any;
  rootCfg: any;
  runtime?: { cleanEnv: boolean; passEnv: string[]; setEnv: Record<string, string> };
}

export type FailureSinkFactory = (args: FailureSinkFactoryArgs) => FailureSink | null;

export const createSpecFailureSink: FailureSinkFactory = (args) => {
  const { rootDir, specPath, spec, rootCfg, runtime } = args;
  const of = spec.command?.onValidationFailure;
  if (!of || !of.shell) return null;
  const cwd = (() => {
    const wd = spec.command?.workingDir;
    const inherit = !!spec.command?.inheritCallerCwd;
    if (inherit)
      return wd ? (path.isAbsolute(wd) ? wd : path.resolve(process.cwd(), wd)) : process.cwd();
    if (!wd) return path.dirname(specPath);
    return path.isAbsolute(wd) ? wd : path.resolve(path.dirname(specPath), wd);
  })();
  const env = runtime
    ? buildChildEnv(rootCfg, spec, {
        cleanEnv: !!runtime.cleanEnv,
        passEnv: runtime.passEnv || [],
        setEnv: runtime.setEnv || {},
      })
    : (() => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env))
          if (typeof v === "string") out[k] = v as string;
        for (const [k, v] of Object.entries(rootCfg.env || {})) out[k] = v as string;
        for (const [k, v] of Object.entries(spec.command?.env || {})) out[k] = v as string;
        return out;
      })();
  const sh = process.env.SHELL && process.env.SHELL.includes("bash") ? "bash" : "/bin/sh";
  const cmd = sh.includes("bash") ? `set -euo pipefail; ${of.shell}` : `set -eu; ${of.shell}`;
  const exeArgs = sh.includes("bash") ? ["--noprofile", "--norc", "-c", cmd] : ["-c", cmd];
  const p = spawn(sh, exeArgs, { cwd, env, stdio: ["pipe", "ignore", "pipe"], detached: true });
  p.stderr.pipe(process.stderr, { end: false });
  try {
    p.stdin.on("error", (e: any) => {
      if (e && e.code === "EPIPE") {
        // ignore
      }
    });
  } catch {}
  let writeChain: Promise<void> = Promise.resolve();
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
          return;
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
          return;
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
};
