import { PassThrough, Writable } from "node:stream";
import { buildArgv, runWithTransforms } from "../core/index.ts";

export type InvocationEvent =
  | { type: "progress"; message?: string; progress?: number }
  | { type: "data"; item: any }
  | { type: "control"; elicit: any }
  | { type: "final"; result: any }
  | { type: "error"; error: { type: string; message: string; data?: any } };

export interface InvocationContext {
  dir: string;
  specPath: string;
  spec: any;
  cfg: any;
}

export interface InvocationLimits {
  collectItems?: number;
  collectBytes?: number;
  maxArgvTokens?: number;
  maxArgvBytes?: number;
  maxStdinBytes?: number;
  maxStdoutJsonBytes?: number;
  maxNdjsonLineBytes?: number;
}

export interface InvocationOptions {
  args: any;
  isNdjson: boolean;
  streamingFinalAggregate: boolean;
  ignoreControlMessages?: boolean;
  limits?: InvocationLimits;
  timeoutMsOverride?: number;
  env?: { cleanEnv?: boolean; passEnv?: string[]; setEnv?: Record<string, string> };
  isCancelled?: () => boolean;
  onProgress?: (info: { message?: string; progress?: number }) => void;
  onItem?: (item: any) => void;
}

function sanitizeControlLine(s: string): string {
  let t = s;
  try {
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  } catch {}
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  t = t.replace(/[\u0080-\u009F]/g, "");
  t = t.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
  t = t.replace(/[\u2028\u2029]/g, "");
  t = t.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, "");
  return t;
}

export async function* runInvocation(
  ctx: InvocationContext,
  opts: InvocationOptions,
): AsyncGenerator<InvocationEvent> {
  const { dir, specPath, spec, cfg } = ctx;
  const ignoreCtl = !!opts.ignoreControlMessages;
  const outStream = new PassThrough();
  const errStream = new PassThrough();
  const inStream = new PassThrough();
  let errTxt = "";
  errStream.on("data", (b) => (errTxt += Buffer.from(b as any).toString("utf8")));

  // Streaming parsing buffers
  let lineBuf = "";
  const streamedItems: any[] = [];
  let sawCtl = false;
  let ctlPayload: any = null;

  const ndjsonSink: Writable | null = new Writable({
    write(chunk, _enc, cb) {
      try {
        const part = Buffer.from(chunk as any).toString("utf8");
        lineBuf += part;
        while (true) {
          const nl = lineBuf.indexOf("\n");
          if (nl < 0) break;
          let line = lineBuf.slice(0, nl);
          lineBuf = lineBuf.slice(nl + 1);
          const s = line.trim();
          if (!s) continue;
          try {
            const s2 = sanitizeControlLine(s);
            let obj: any = JSON.parse(s2);
            if (typeof obj === "string") {
              try {
                obj = JSON.parse(obj);
              } catch {}
            }
            if (
              !ignoreCtl &&
              obj &&
              typeof obj === "object" &&
              obj["$jio.ctl"] === true &&
              obj["$jio.ctl.elicit"]
            ) {
              ctlPayload = obj["$jio.ctl.elicit"];
              sawCtl = true;
              continue;
            }
            streamedItems.push(obj);
            try {
              opts.onItem?.(obj);
            } catch {}
          } catch {}
        }
      } finally {
        cb();
      }
    },
    final(cb) {
      try {
        const trailing = lineBuf.trim();
        if (trailing) {
          try {
            const s2 = sanitizeControlLine(trailing);
            let obj: any = JSON.parse(s2);
            if (typeof obj === "string") {
              try {
                obj = JSON.parse(obj);
              } catch {}
            }
            if (!ignoreCtl && obj && typeof obj === "object" && obj["$jio.ctl"] === true) {
              if (obj["$jio.ctl.elicit"]) {
                ctlPayload = obj["$jio.ctl.elicit"];
                sawCtl = true;
              }
            } else {
              streamedItems.push(obj);
              try {
                opts.onItem?.(obj);
              } catch {}
            }
          } catch {}
        }
      } finally {
        cb();
      }
    },
  });

  const origFmt = (() => {
    try {
      return (spec?.command as any)?.stdoutTransform?.format;
    } catch {
      return undefined;
    }
  })();
  const firstRunNdjson = (() => {
    try {
      return opts.isNdjson || (origFmt === "json" && !ignoreCtl);
    } catch {
      return opts.isNdjson;
    }
  })();

  const specForRun = (() => {
    try {
      return {
        ...spec,
        tool: { ...(spec.tool || {}), outputSchema: undefined },
        command: {
          ...(spec.command || {}),
          stdoutTransform:
            origFmt === "json" && !ignoreCtl
              ? ({ shell: "cat", format: "ndjson" } as any)
              : ((spec.command as any)?.stdoutTransform as any) ||
                ({ shell: "cat", format: "ndjson" } as any),
        },
      } as any;
    } catch {
      return spec as any;
    }
  })();

  const code = await runWithTransforms(
    dir,
    ctx.specPath,
    specForRun,
    buildArgv(spec as any, opts.args ?? {}),
    cfg as any,
    opts.args ?? {},
    {
      collect: !firstRunNdjson,
      collectLimit: opts.limits?.collectItems,
      limits: {
        collectItems: opts.limits?.collectItems,
        collectBytes: opts.limits?.collectBytes,
        maxArgvTokens: opts.limits?.maxArgvTokens,
        maxArgvBytes: opts.limits?.maxArgvBytes,
        maxStdinBytes: opts.limits?.maxStdinBytes,
        maxStdoutJsonBytes: opts.limits?.maxStdoutJsonBytes,
        maxNdjsonLineBytes: opts.limits?.maxNdjsonLineBytes,
      },
      timeoutMsOverride: opts.timeoutMsOverride,
      cleanEnv: opts.env?.cleanEnv !== false,
      passEnv: opts.env?.passEnv || [],
      setEnv: opts.env?.setEnv || {},
      stdoutTarget: firstRunNdjson ? (ndjsonSink as any) : (outStream as any),
      stderrTarget: errStream as any,
      inputSource: inStream as any,
      isCancelled: () => (opts.isCancelled ? !!opts.isCancelled() : false),
      onProgress:
        opts.onProgress && process.env.JIO_MCP_PROGRESS !== "0"
          ? (info: { items?: number; bytes?: number; message?: string; progress?: number }) => {
              try {
                opts.onProgress?.({ message: info.message, progress: info.progress });
              } catch {}
            }
          : undefined,
    } as any,
  );

  if (code && code !== 0) {
    return yield { type: "error", error: { type: "Error", message: `exit ${code}` } };
  }

  // If we saw control, emit control and return
  if (!ignoreCtl && sawCtl && ctlPayload) {
    return yield { type: "control", elicit: ctlPayload };
  }

  if (firstRunNdjson) {
    // If the original tool format was JSON (we forced NDJSON to detect control),
    // perform a second run with the original spec to produce the final JSON result.
    if (origFmt === "json" && !opts.isNdjson) {
      // Emit any seen items as data events for symmetry
      for (const it of streamedItems) {
        yield { type: "data", item: it };
      }
      try {
        const out2 = new PassThrough();
        const err2 = new PassThrough();
        let outTxt2 = "";
        err2.on("data", () => void 0);
        out2.on("data", (b) => (outTxt2 += Buffer.from(b as any).toString("utf8")));
        const code2 = await runWithTransforms(
          dir,
          ctx.specPath,
          spec as any,
          buildArgv(spec as any, opts.args ?? {}),
          cfg as any,
          opts.args ?? {},
          {
            collect: true,
            collectLimit: opts.limits?.collectItems,
            limits: {
              collectItems: opts.limits?.collectItems,
              collectBytes: opts.limits?.collectBytes,
              maxArgvTokens: opts.limits?.maxArgvTokens,
              maxArgvBytes: opts.limits?.maxArgvBytes,
              maxStdinBytes: opts.limits?.maxStdinBytes,
              maxStdoutJsonBytes: opts.limits?.maxStdoutJsonBytes,
              maxNdjsonLineBytes: opts.limits?.maxNdjsonLineBytes,
            },
            timeoutMsOverride: opts.timeoutMsOverride,
            cleanEnv: opts.env?.cleanEnv !== false,
            passEnv: opts.env?.passEnv || [],
            setEnv: opts.env?.setEnv || {},
            stdoutTarget: out2 as any,
            stderrTarget: err2 as any,
            inputSource: new PassThrough() as any,
            isCancelled: () => (opts.isCancelled ? !!opts.isCancelled() : false),
          } as any,
        );
        if (code2 && code2 !== 0)
          return yield { type: "error", error: { type: "Error", message: `exit ${code2}` } };
        const obj2 = outTxt2 ? JSON.parse(outTxt2) : null;
        yield { type: "final", result: obj2 };
      } catch {
        yield { type: "error", error: { type: "InvalidJSON", message: "invalid JSON output" } };
      }
      return;
    }
    // True NDJSON tool: emit items and optional aggregate
    for (const it of streamedItems) {
      yield { type: "data", item: it };
    }
    yield {
      type: "final",
      result: opts.streamingFinalAggregate ? { items: streamedItems.slice() } : undefined,
    };
    return;
  }

  // JSON: parse once from outStream buffer
  let outTxt = "";
  try {
    outStream.on("data", (b) => (outTxt += Buffer.from(b as any).toString("utf8")));
    await new Promise((r) => outStream.on("end", r));
  } catch {}
  try {
    const obj = outTxt ? JSON.parse(outTxt) : null;
    yield { type: "final", result: obj };
  } catch {
    yield {
      type: "error",
      error: { type: "InvalidJSON", message: errTxt || "invalid JSON output" },
    };
  }
}
