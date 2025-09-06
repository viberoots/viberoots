import { PassThrough, Writable } from "node:stream";
import { buildArgv, runWithTransforms } from "../core/index.ts";
import { ELICIT_KEY, isControl, isElicit, sanitizeControlString } from "./elicitation.ts";

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
  input?: NodeJS.ReadableStream;
}

// sanitizeControlLine now delegates to the centralized function
const sanitizeControlLine = sanitizeControlString;

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
  // If caller provided an input stream (e.g., CLI process.stdin), forward into inStream
  try {
    if (opts.input) {
      opts.input.on("error", () => void 0);
      opts.input.pipe(inStream);
    }
  } catch {}

  // Streaming parsing buffers
  let lineBuf = "";
  const streamedItems: any[] = [];
  let sawCtl = false;
  let ctlPayload: any = null;
  // Raw capture of first run output for JSON fallback when forcing NDJSON
  let outRawFirstRun = "";

  const ndjsonSink: Writable | null = new Writable({
    write(chunk, _enc, cb) {
      try {
        const part = Buffer.from(chunk as any).toString("utf8");
        outRawFirstRun += part;
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
            if (!ignoreCtl && obj && typeof obj === "object" && isElicit(obj)) {
              ctlPayload = (obj as any)[ELICIT_KEY];
              sawCtl = true;
              continue;
            }
            streamedItems.push(obj);
            try {
              opts.onItem?.(obj);
            } catch {}
          } catch {
            // Salvage: try to parse JSON object substring
            try {
              const i0 = s2.indexOf("{");
              const i1 = s2.lastIndexOf("}");
              if (i0 >= 0 && i1 > i0) {
                let obj: any = JSON.parse(s2.slice(i0, i1 + 1));
                if (typeof obj === "string") {
                  try {
                    obj = JSON.parse(obj);
                  } catch {}
                }
                if (!ignoreCtl && obj && typeof obj === "object" && isElicit(obj)) {
                  ctlPayload = (obj as any)[ELICIT_KEY];
                  sawCtl = true;
                  continue;
                }
                streamedItems.push(obj);
                try {
                  opts.onItem?.(obj);
                } catch {}
              }
            } catch {}
          }
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
            if (!ignoreCtl && obj && typeof obj === "object" && isControl(obj)) {
              if ((obj as any)[ELICIT_KEY]) {
                ctlPayload = (obj as any)[ELICIT_KEY];
                sawCtl = true;
              }
            } else {
              streamedItems.push(obj);
              try {
                opts.onItem?.(obj);
              } catch {}
            }
          } catch {
            // Salvage trailing JSON object
            try {
              const i0 = s2.indexOf("{");
              const i1 = s2.lastIndexOf("}");
              if (i0 >= 0 && i1 > i0) {
                let obj: any = JSON.parse(s2.slice(i0, i1 + 1));
                if (typeof obj === "string") {
                  try {
                    obj = JSON.parse(obj);
                  } catch {}
                }
                if (!ignoreCtl && obj && typeof obj === "object" && isElicit(obj)) {
                  ctlPayload = (obj as any)[ELICIT_KEY];
                  sawCtl = true;
                } else {
                  streamedItems.push(obj);
                  try {
                    opts.onItem?.(obj);
                  } catch {}
                }
              }
            } catch {}
          }
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
      const hasElicitResp = !!(opts.args && (opts.args as any)["$jio.ctl.elicit.response"]);
      return opts.isNdjson || (origFmt === "json" && !ignoreCtl && !hasElicitResp);
    } catch {
      return opts.isNdjson;
    }
  })();

  try {
    process.stderr.write(
      JSON.stringify({
        type: "INV_DEBUG_PRE",
        where: "pre",
        origFmt: String(origFmt || ""),
        firstRunNdjson,
        hasResp: !!(opts.args && (opts.args as any)["$jio.ctl.elicit.response"]),
        ignoreCtl,
      }) + "\n",
    );
  } catch {}

  const specForRun = (() => {
    try {
      return {
        ...spec,
        tool: { ...(spec.tool || {}), outputSchema: undefined },
        command: {
          ...(spec.command || {}),
          stdoutTransform:
            origFmt === "json" &&
            !ignoreCtl &&
            !(opts.args && (opts.args as any)["$jio.ctl.elicit.response"])
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

  try {
    process.stderr.write(
      JSON.stringify({
        type: "INV_DEBUG_POST",
        where: "post",
        code,
        sawCtl,
        hasCtl: !!ctlPayload,
        firstRunNdjson,
      }) + "\n",
    );
  } catch {}

  // If we saw control, emit control and return
  if (!ignoreCtl && sawCtl && ctlPayload) {
    return yield { type: "control", elicit: ctlPayload };
  }

  if (firstRunNdjson) {
    // If the original tool format was JSON (we forced NDJSON to detect control),
    // perform a second run with the original spec to produce the final JSON result.
    if (origFmt === "json" && !opts.isNdjson) {
      // First: try buffered fallback for control immediately; if found, yield control and return
      if (!sawCtl && outRawFirstRun) {
        try {
          const sample = outRawFirstRun.slice(0, 400);
          process.stderr.write(
            JSON.stringify({
              type: "INV_DEBUG_RAW",
              where: "rawFirst",
              len: outRawFirstRun.length,
              sample,
            }) + "\n",
          );
        } catch (e: any) {
          try {
            let bufSan = sanitizeControlLine(outRawFirstRun);
            bufSan = bufSan.replace(/^\s+|\s+$/g, "");
            bufSan = bufSan.replace(/[\r\n]+$/g, "");
            process.stderr.write(
              JSON.stringify({
                type: "INV_DEBUG_RAW",
                where: "rawFirst.parseError",
                message: String(e?.message || e),
                tail: bufSan.slice(-60),
                len: bufSan.length,
              }) + "\n",
            );
          } catch {}
        }
        // Heuristic: detect control without full JSON parse, then extract elicit payload
        try {
          const s2h = sanitizeControlLine(outRawFirstRun).trim();
          if (s2h.includes('"$jio.ctl"') && s2h.includes('"$jio.ctl.elicit"')) {
            const key = '"$jio.ctl.elicit"';
            const kpos = s2h.indexOf(key);
            if (kpos >= 0) {
              const colon = s2h.indexOf(":", kpos + key.length);
              if (colon > 0) {
                let i = colon + 1;
                while (i < s2h.length && s2h[i] !== "{") i++;
                if (i < s2h.length) {
                  let depth = 0;
                  let j = i;
                  for (; j < s2h.length; j++) {
                    const ch = s2h[j];
                    if (ch === "{") depth++;
                    else if (ch === "}") {
                      depth--;
                      if (depth === 0) {
                        j++;
                        break;
                      }
                    }
                  }
                  if (j > i) {
                    const payloadStr = s2h.slice(i, j);
                    try {
                      const payload = JSON.parse(payloadStr);
                      try {
                        process.stderr.write(
                          JSON.stringify({
                            type: "inv.debug",
                            where: "rawFirst.heuristic.control",
                          }) + "\n",
                        );
                      } catch {}
                      return yield { type: "control", elicit: payload };
                    } catch {}
                  }
                }
              }
            }
          }
        } catch {}
        try {
          let bufSan = sanitizeControlLine(outRawFirstRun);
          bufSan = bufSan.replace(/^\s+|\s+$/g, "");
          bufSan = bufSan.replace(/[\r\n]+$/g, "");
          let obj: any = JSON.parse(bufSan);
          if (typeof obj === "string") {
            try {
              obj = JSON.parse(obj);
            } catch {}
          }
          try {
            const info = {
              type: typeof obj,
              keys: obj && typeof obj === "object" ? Object.keys(obj).slice(0, 5) : [],
              hasCtl: !!(obj && typeof obj === "object" && (obj as any)["$jio.ctl"] === true),
              hasElicit: !!(
                obj &&
                typeof obj === "object" &&
                (obj as any)["$jio.ctl.elicit"] !== undefined
              ),
            };
            process.stderr.write(
              JSON.stringify({ type: "INV_DEBUG_RAW", where: "rawFirst.parsed", info }) + "\n",
            );
          } catch {}
          if (!ignoreCtl && obj && typeof obj === "object" && isElicit(obj)) {
            try {
              process.stderr.write(
                JSON.stringify({ type: "inv.debug", where: "rawFirst.controlDetected" }) + "\n",
              );
            } catch {}
            return yield { type: "control", elicit: (obj as any)[ELICIT_KEY] };
          }
        } catch {
          // Salvage: try to parse JSON object substring from buffered first run
          try {
            let bufSan = sanitizeControlLine(outRawFirstRun);
            bufSan = bufSan.replace(/^[\s\u0000-\u001F]+|[\s\u0000-\u001F]+$/g, "");
            const i0 = bufSan.indexOf("{");
            const i1 = bufSan.lastIndexOf("}");
            if (i0 >= 0 && i1 > i0) {
              let obj: any = JSON.parse(bufSan.slice(i0, i1 + 1));
              if (typeof obj === "string") {
                try {
                  obj = JSON.parse(obj);
                } catch {}
              }
              if (!ignoreCtl && obj && typeof obj === "object" && isElicit(obj)) {
                try {
                  process.stderr.write(
                    JSON.stringify({ type: "inv.debug", where: "rawFirst.salvage.control" }) + "\n",
                  );
                } catch {}
                return yield { type: "control", elicit: (obj as any)[ELICIT_KEY] };
              }
            }
          } catch {}
        }
      }
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
        if (!ignoreCtl && obj2 && typeof obj2 === "object" && isElicit(obj2)) {
          return yield { type: "control", elicit: (obj2 as any)[ELICIT_KEY] };
        }
        yield { type: "final", result: obj2 };
      } catch {
        yield { type: "error", error: { type: "InvalidJSON", message: "invalid JSON output" } };
      }
      return;
    }
    // True NDJSON tool: emit items and optional aggregate
    if (code && code !== 0) {
      return yield {
        type: "error",
        error: { type: "Error", message: errTxt || `exit ${code}` },
      };
    }
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
    if (!ignoreCtl && obj && typeof obj === "object" && isElicit(obj)) {
      return yield { type: "control", elicit: (obj as any)[ELICIT_KEY] };
    }
    yield { type: "final", result: obj };
  } catch {
    yield {
      type: "error",
      error: { type: "InvalidJSON", message: errTxt || "invalid JSON output" },
    };
  }
}
