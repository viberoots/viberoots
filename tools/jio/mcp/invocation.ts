import { PassThrough, Writable } from "node:stream";
import { buildArgv, runWithTransforms } from "../core/index.ts";
import { ELICIT_KEY, isControl, isElicit, sanitizeControlString } from "./elicitation.ts";
import { classifyError, type TaxonomyError } from "./errors.ts";
import type { FailureSink, FailureSinkFactory } from "./sink.ts";
import { createSpecFailureSink } from "./sink.ts";

export type InvocationEvent =
  | { type: "progress"; message?: string; progress?: number }
  | { type: "data"; item: any }
  | { type: "control"; elicit: any }
  | { type: "final"; result: any }
  | { type: "error"; error: TaxonomyError };

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
  stdinTransform?: "json" | "ndjson";
  sink?: FailureSink;
  sinkFactory?: FailureSinkFactory;
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
  let sawTimeout = false;
  errStream.on("data", (b) => {
    const t = Buffer.from(b as any).toString("utf8");
    errTxt += t;
    if (/timeout/i.test(t) || /premature close/i.test(t)) sawTimeout = true;
  });
  // Prepare stdin enforcement (optional)
  let stdinParseFailed = false;
  let stdinLimitExceeded = false;
  const effectiveStdinFmt: "json" | "ndjson" | undefined = (() => {
    try {
      return (
        (opts.stdinTransform as any) || ((spec?.command as any)?.stdinTransform?.format as any)
      );
    } catch {
      return opts.stdinTransform as any;
    }
  })();
  const stdinSource: NodeJS.ReadableStream = opts.input || (process.stdin as any);
  let stdinEnforceDone: Promise<void> | null = null;
  const writeWithDrain = async (w: NodeJS.WritableStream, data: string | Buffer) => {
    const ok = w.write(data);
    if (!ok) await new Promise<void>((res) => w.once("drain", res));
  };
  const startEnforceNdjson = () => {
    stdinEnforceDone = (async () => {
      let total = 0;
      let sawFirst = false;
      let buf = "";
      for await (const chunk of stdinSource as any) {
        const part = Buffer.from(chunk as any).toString("utf8");
        total += Buffer.byteLength(part);
        if (opts.limits?.maxStdinBytes && total > (opts.limits.maxStdinBytes as number)) {
          try {
            process.stderr.write("jio: stdin bytes limit exceeded\n");
          } catch {}
          stdinLimitExceeded = true;
          break;
        }
        buf += part;
        while (true) {
          const nl = buf.indexOf("\n");
          if (nl < 0) break;
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          let s = String(line);
          if (s.trim() === "") continue;
          if (!sawFirst) {
            sawFirst = true;
            if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
          }
          if (s.endsWith("\r")) s = s.slice(0, -1);
          try {
            JSON.parse(s);
          } catch {
            try {
              process.stderr.write("jio: stdinTransform emitted non-JSON line\n");
            } catch {}
            stdinParseFailed = true;
            buf = ""; // drop remaining
            break;
          }
          await writeWithDrain(inStream, s + "\n");
        }
        if (stdinParseFailed || stdinLimitExceeded) break;
      }
      // drain trailing
      const trailing = buf.trim();
      if (!stdinParseFailed && !stdinLimitExceeded && trailing) {
        let s = trailing;
        if (!sawFirst && s.charCodeAt(0) === 0xfeff) s = s.slice(1);
        if (s.endsWith("\r")) s = s.slice(0, -1);
        try {
          JSON.parse(s);
          await writeWithDrain(inStream, s + "\n");
        } catch {
          try {
            process.stderr.write("jio: stdinTransform emitted non-JSON line\n");
          } catch {}
          stdinParseFailed = true;
        }
      }
      try {
        inStream.end();
      } catch {}
    })();
  };
  const startEnforceJson = () => {
    stdinEnforceDone = (async () => {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of stdinSource as any) {
        const c = Buffer.from(chunk as any);
        total += c.length;
        if (opts.limits?.maxStdinBytes && total > (opts.limits.maxStdinBytes as number)) {
          try {
            process.stderr.write("jio: stdin bytes limit exceeded (json)\n");
          } catch {}
          stdinLimitExceeded = true;
          break;
        }
        chunks.push(c);
      }
      if (!stdinLimitExceeded) {
        let buf = Buffer.concat(chunks).toString("utf8");
        if (buf && buf.charCodeAt(0) === 0xfeff) buf = buf.slice(1);
        const trimmed = buf.replace(/^\s+|\s+$/g, "");
        try {
          if (trimmed) JSON.parse(trimmed);
          await writeWithDrain(inStream, trimmed);
        } catch {
          try {
            process.stderr.write("jio: stdinTransform did not emit valid JSON\n");
          } catch {}
          stdinParseFailed = true;
        }
      }
      try {
        inStream.end();
      } catch {}
    })();
  };
  try {
    if (effectiveStdinFmt === "ndjson") startEnforceNdjson();
    else if (effectiveStdinFmt === "json") startEnforceJson();
    else {
      // No transform: direct pipe
      if (opts.input) {
        opts.input.on("error", () => void 0);
        opts.input.pipe(inStream);
      }
    }
  } catch {}

  // Streaming parsing buffers
  let lineBuf = "";
  const streamedItems: any[] = [];
  let sawCtl = false;
  let ctlPayload: any = null;
  // Raw capture of first run output for JSON fallback when forcing NDJSON
  let outRawFirstRun = "";
  // NDJSON collect/limit state (unified policy)
  const maxLineBytes = Number.isFinite(opts.limits?.maxNdjsonLineBytes as number)
    ? (opts.limits?.maxNdjsonLineBytes as number)
    : undefined;
  const maxCollectItems = Number.isFinite(opts.limits?.collectItems as number)
    ? (opts.limits?.collectItems as number)
    : undefined;
  const maxCollectBytes = Number.isFinite(opts.limits?.collectBytes as number)
    ? (opts.limits?.collectBytes as number)
    : undefined;
  let itemsCollected = 0;
  let bytesCollected = 0;
  let suppressFurther = false;

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
          if (maxLineBytes && Buffer.byteLength(s) > maxLineBytes) {
            // drop overlong line, continue
            continue;
          }
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
            if (opts.streamingFinalAggregate) {
              if (!suppressFurther) {
                const str = (() => {
                  try {
                    return JSON.stringify(obj);
                  } catch {
                    return "";
                  }
                })();
                const b = Buffer.byteLength(str);
                if (maxCollectBytes && bytesCollected + b > maxCollectBytes) {
                  suppressFurther = true;
                } else if (maxCollectItems && itemsCollected >= maxCollectItems) {
                  suppressFurther = true;
                } else {
                  streamedItems.push(obj);
                  itemsCollected++;
                  bytesCollected += b;
                  try {
                    opts.onItem?.(obj);
                  } catch {}
                }
              }
            } else {
              streamedItems.push(obj);
              try {
                opts.onItem?.(obj);
              } catch {}
            }
          } catch {
            // Record invalid NDJSON line to failure sink, then try to salvage JSON object substring
            try {
              const preview = (typeof s2 === "string" ? s2 : String(s)).slice(0, 200);
              (sink as any)
                ?.write?.({ reason: "stdout", object: preview, message: "invalid NDJSON" })
                ?.catch?.(() => undefined);
            } catch {}
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
                if (opts.streamingFinalAggregate) {
                  if (!suppressFurther) {
                    const str = (() => {
                      try {
                        return JSON.stringify(obj);
                      } catch {
                        return "";
                      }
                    })();
                    const b = Buffer.byteLength(str);
                    if (maxCollectBytes && bytesCollected + b > maxCollectBytes) {
                      suppressFurther = true;
                    } else if (maxCollectItems && itemsCollected >= maxCollectItems) {
                      suppressFurther = true;
                    } else {
                      streamedItems.push(obj);
                      itemsCollected++;
                      bytesCollected += b;
                      try {
                        opts.onItem?.(obj);
                      } catch {}
                    }
                  }
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
    final(cb) {
      try {
        const trailing = lineBuf.trim();
        if (trailing) {
          if (maxLineBytes && Buffer.byteLength(trailing) > maxLineBytes) {
            // drop overlong trailing line
            return cb();
          }
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
              if (opts.streamingFinalAggregate) {
                if (!suppressFurther) {
                  const str = (() => {
                    try {
                      return JSON.stringify(obj);
                    } catch {
                      return "";
                    }
                  })();
                  const b = Buffer.byteLength(str);
                  if (maxCollectBytes && bytesCollected + b > maxCollectBytes) {
                    suppressFurther = true;
                  } else if (maxCollectItems && itemsCollected >= maxCollectItems) {
                    suppressFurther = true;
                  } else {
                    streamedItems.push(obj);
                    itemsCollected++;
                    bytesCollected += b;
                    try {
                      opts.onItem?.(obj);
                    } catch {}
                  }
                }
              } else {
                streamedItems.push(obj);
                try {
                  opts.onItem?.(obj);
                } catch {}
              }
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
                  if (opts.streamingFinalAggregate) {
                    if (!suppressFurther) {
                      const str = (() => {
                        try {
                          return JSON.stringify(obj);
                        } catch {
                          return "";
                        }
                      })();
                      const b = Buffer.byteLength(str);
                      if (maxCollectBytes && bytesCollected + b > maxCollectBytes) {
                        suppressFurther = true;
                      } else if (maxCollectItems && itemsCollected >= maxCollectItems) {
                        suppressFurther = true;
                      } else {
                        streamedItems.push(obj);
                        itemsCollected++;
                        bytesCollected += b;
                        try {
                          opts.onItem?.(obj);
                        } catch {}
                      }
                    }
                  } else {
                    streamedItems.push(obj);
                    try {
                      opts.onItem?.(obj);
                    } catch {}
                  }
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
          // Remove stdinTransform when enforcing at this layer
          stdinTransform: effectiveStdinFmt ? undefined : (spec as any)?.command?.stdinTransform,
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

  // Build failure sink (spec-based by default)
  const sink = (() => {
    if (opts.sink) return opts.sink;
    const fac = opts.sinkFactory || createSpecFailureSink;
    try {
      return fac({
        rootDir: dir,
        specPath,
        spec,
        rootCfg: cfg,
        runtime: {
          cleanEnv: opts.env?.cleanEnv !== false,
          passEnv: opts.env?.passEnv || [],
          setEnv: opts.env?.setEnv || {},
        },
      });
    } catch {
      return null;
    }
  })();

  let code: number | undefined;
  try {
    code = await runWithTransforms(
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
  } catch (e: any) {
    return yield { type: "error", error: classifyError(e?.message || e) };
  }

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

  // Check stdin enforcement results (if any)
  try {
    if (stdinEnforceDone) await stdinEnforceDone;
  } catch {}
  if (stdinLimitExceeded) {
    return yield { type: "error", error: classifyError("stdin bytes limit exceeded") };
  }
  if (stdinParseFailed) {
    try {
      await sink?.write?.({ reason: "stdin", object: "", message: "invalid JSON document" });
    } catch {}
    return yield { type: "error", error: classifyError("invalid stdin") };
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
      // If the first run indicated a timeout, surface it rather than attempting a second run
      try {
        const et = (errTxt || "").toLowerCase();
        if (et.includes("timeout")) {
          return yield { type: "error", error: classifyError("timeout") };
        }
      } catch {}
      // Emit any seen items as data events for symmetry
      for (const it of streamedItems) {
        yield { type: "data", item: it };
      }
      try {
        const out2 = new PassThrough();
        const err2 = new PassThrough();
        let outTxt2 = "";
        let errTxt2 = "";
        err2.on("data", (b) => (errTxt2 += Buffer.from(b as any).toString("utf8")));
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
        if (code2 && code2 !== 0) {
          if (code2 === 65)
            return yield {
              type: "error",
              error: {
                kind: "InvalidJson",
                message: errTxt2 || `exit ${code2}`,
                data: { exitCode: code2 },
              },
            } as any;
          if (code2 === 78)
            return yield {
              type: "error",
              error: {
                kind: "ConfigError",
                message: errTxt2 || `exit ${code2}`,
                data: { exitCode: code2 },
              },
            } as any;
          if (code2 === 124)
            return yield {
              type: "error",
              error: {
                kind: "Timeout",
                message: errTxt2 || `exit ${code2}`,
                data: { exitCode: code2 },
              },
            } as any;
          return yield { type: "error", error: classifyError(errTxt2 || `exit ${code2}`) };
        }
        const obj2 = outTxt2 ? JSON.parse(outTxt2) : null;
        if (!ignoreCtl && obj2 && typeof obj2 === "object" && isElicit(obj2)) {
          return yield { type: "control", elicit: (obj2 as any)[ELICIT_KEY] };
        }
        if (sawTimeout)
          return yield {
            type: "error",
            error: { kind: "Timeout", message: errTxt || "timeout" },
          } as any;
        yield { type: "final", result: obj2 };
      } catch {
        yield { type: "error", error: classifyError("invalid JSON output") };
      }
      return;
    }
    // True NDJSON tool: emit items and optional aggregate
    if (code && code !== 0) {
      return yield { type: "error", error: classifyError(errTxt || `exit ${code}`) };
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

  // JSON: parse once from outStream buffer with exit-code precedence
  let outTxt = "";
  try {
    outStream.on("data", (b) => (outTxt += Buffer.from(b as any).toString("utf8")));
    await new Promise((r) => outStream.on("end", r));
  } catch {}
  try {
    const obj = outTxt ? JSON.parse(outTxt) : null;
    if (code && code !== 0) {
      return yield { type: "error", error: classifyError(errTxt || `exit ${code}`) };
    }
    if (!ignoreCtl && obj && typeof obj === "object" && isElicit(obj)) {
      return yield { type: "control", elicit: (obj as any)[ELICIT_KEY] };
    }
    yield { type: "final", result: obj };
  } catch {
    const et = (errTxt || "").toLowerCase();
    if (sawTimeout || et.includes("timeout")) {
      yield { type: "error", error: classifyError("timeout") };
    } else {
      yield { type: "error", error: classifyError(errTxt || "invalid JSON output") };
    }
  }
}
