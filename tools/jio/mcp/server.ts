import Ajv from "ajv";
import * as fss from "node:fs";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import {
  buildArgv,
  discoverJioTools,
  generateInputSchemaFromParameters,
  runWithTransforms,
} from "../core/index.ts";
import { emitZodWarning, getZodRawShape, jsonSchemaToZodSafe } from "./schema.ts";

export type McpServerOpts = {
  transport?: "stdio" | "http";
  httpHost?: string;
  httpPort?: number;
  // For tests and embedding: override root directory used for discovery/resources
  rootDir?: string;
  timeoutMs?: number;
  collectLimit?: number;
  collectBytes?: number;
  cleanEnv?: boolean;
  passEnv?: string[];
  setEnv?: Record<string, string>;
  // PR4: server-level limits and concurrency
  maxArgvTokens?: number;
  maxArgvBytes?: number;
  maxStdinBytes?: number;
  maxStdoutJsonBytes?: number;
  maxNdjsonLineBytes?: number;
  maxItemsPerCall?: number;
  maxCollectBytes?: number;
  maxConcurrentCalls?: number;
  queueSize?: number;
  queueTimeoutMs?: number;
  // Streaming behavior: include final aggregate {items} in responses
  streamingFinalAggregate?: boolean;
};

async function readVersion(): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const pkgPath = resolve(process.cwd(), "package.json");
    const txt = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(txt);
    if (pkg && typeof pkg.version === "string") return pkg.version as string;
  } catch {}
  return "0.0.0";
}

export async function startMcpServer(
  opts: McpServerOpts = {},
): Promise<{ close?: () => Promise<void> } | void> {
  if ((opts as any).transport === "http") {
    const { createServer } = await import("node:http");
    const { StreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/streamableHttp.js"
    );
    const host = opts.httpHost || "127.0.0.1";
    const port = Number.isFinite(opts.httpPort as number) ? (opts.httpPort as number) : 3000;

    // Build MCP server and register tools
    const { dir, cfg, specs, index } = await discoverJioTools(opts.rootDir);
    const { ResourceRegistry, computeResourceMeta } = await import("../core/resources.ts");
    const Mcp = (await import("@modelcontextprotocol/sdk/server/mcp.js")).McpServer;
    const { CancelledNotificationSchema, ProgressNotificationSchema } = await import(
      "@modelcontextprotocol/sdk/types.js"
    );
    const mcp = new Mcp({ name: "jio-mcp", version: await readVersion() });
    try {
      (mcp as any).server?.registerCapabilities?.({ tools: { listChanged: true } });
    } catch {}
    const ajv = new Ajv({ strict: true, allErrors: true });
    // PR4: simple fair semaphore for concurrency control
    const maxConcurrent = Number.isFinite(opts.maxConcurrentCalls as number)
      ? Math.max(0, opts.maxConcurrentCalls as number)
      : 0; // 0 = unlimited
    const queueSize = Number.isFinite(opts.queueSize as number)
      ? Math.max(0, opts.queueSize as number)
      : 0;
    const queueTimeoutMs = Number.isFinite(opts.queueTimeoutMs as number)
      ? Math.max(0, opts.queueTimeoutMs as number)
      : 0;
    let inFlight = 0;
    const waitQueue: Array<{
      res: (v: () => void) => void;
      rej: (e: any) => void;
      t?: NodeJS.Timeout;
    }> = [];
    const release = () => {
      inFlight = Math.max(0, inFlight - 1);
      const next = waitQueue.shift();
      if (next) {
        clearTimeout(next.t as any);
        inFlight++;
        next.res(() => release());
      }
    };
    const acquire = async (): Promise<() => void> => {
      if (!maxConcurrent || inFlight < maxConcurrent) {
        inFlight++;
        return () => release();
      }
      if (waitQueue.length >= queueSize) {
        throw Object.assign(new Error("Server busy"), { code: "ServerBusy" });
      }
      return await new Promise<() => void>((res, rej) => {
        const entry: any = { res, rej };
        if (queueTimeoutMs > 0) {
          entry.t = setTimeout(() => {
            const idx = waitQueue.indexOf(entry);
            if (idx >= 0) waitQueue.splice(idx, 1);
            rej(Object.assign(new Error("Queue timeout"), { code: "QueueTimeout" }));
          }, queueTimeoutMs);
        }
        waitQueue.push(entry);
      });
    };
    const inflight = new Map<string, { cancelled: boolean }>();
    let cancelAll = false;
    const keyForId = (id: any): string => (typeof id === "string" ? id : String(id));
    try {
      (mcp as any).server?.setNotificationHandler?.(
        CancelledNotificationSchema,
        async (notification: any) => {
          const id = notification?.params?.requestId;
          if (id !== undefined && id !== null) {
            const k = keyForId(id);
            if (inflight.has(k)) inflight.set(k, { cancelled: true });
            else if (inflight.size === 1) {
              const first = [...inflight.keys()][0];
              if (first) inflight.set(first, { cancelled: true });
            } else {
              cancelAll = true;
            }
          } else {
            for (const k of inflight.keys()) inflight.set(k, { cancelled: true });
            cancelAll = true;
          }
        },
      );
    } catch {}

    for (const [fq, spec] of specs) {
      const inputSchema = spec.tool?.inputSchema || generateInputSchemaFromParameters(spec);
      const description = spec.tool?.description || fq;
      const validateIn = inputSchema ? ajv.compile(inputSchema) : null;
      const outputSchema = spec.tool?.outputSchema || null;
      const validateOut = outputSchema ? ajv.compile(outputSchema) : null;
      let allowedKeys: Set<string> | null = null;
      if (inputSchema && (inputSchema as any).type === "object") {
        const hasProps = !!(inputSchema as any).properties;
        const addl = (inputSchema as any).additionalProperties;
        if (addl === false) {
          allowedKeys = new Set(Object.keys((inputSchema as any).properties || {}));
        } else if (hasProps) {
          allowedKeys = new Set(Object.keys((inputSchema as any).properties));
        }
      }

      const isValidZodShape = (shape: any): boolean => {
        try {
          if (!shape || typeof shape !== "object") return false;
          for (const k of Object.keys(shape)) {
            const v: any = (shape as any)[k];
            const ok =
              v &&
              typeof v === "object" &&
              (typeof (v as any).parse === "function" || typeof (v as any)._parse === "function");
            if (!ok) return false;
          }
          return true;
        } catch {
          return false;
        }
      };

      let maybeParams: any | undefined = undefined;
      let maybeOutput: any | undefined = undefined;
      let zodOutForValidation: any | null = null;
      if (inputSchema) {
        const conv = await jsonSchemaToZodSafe(inputSchema);
        if (conv.zod) {
          // HTTP path: register with Zod raw shape (SDK wraps with z.object(shape))
          try {
            const shape = getZodRawShape(conv.zod);
            if (shape && typeof shape === "object") maybeParams = shape;
          } catch {}
        } else if (conv.reasons && conv.reasons.length) {
          emitZodWarning({ tool: fq, reasons: conv.reasons, schema: inputSchema, kind: "input" });
        }
      }
      if (outputSchema) {
        const conv = await jsonSchemaToZodSafe(outputSchema);
        if (conv.zod) {
          // HTTP path: register with Zod raw shape; keep full Zod instance for internal validation
          try {
            const shape = getZodRawShape(conv.zod);
            if (shape && typeof shape === "object") maybeOutput = shape;
          } catch {}
          zodOutForValidation = conv.zod;
        } else if (conv.reasons && conv.reasons.length) {
          emitZodWarning({ tool: fq, reasons: conv.reasons, schema: outputSchema, kind: "output" });
        }
      }
      // Do not register output schema for NDJSON tools to avoid SDK structuredContent mismatch
      try {
        if ((spec as any)?.command?.stdoutTransform?.format === "ndjson") {
          maybeOutput = undefined;
        }
      } catch {}

      const registeredOutputKeyCount =
        maybeOutput && typeof maybeOutput === "object" ? Object.keys(maybeOutput).length : -1;
      const registerWith = (cb: any) => {
        try {
          const it = maybeParams && (maybeParams as any)._def ? "zod" : typeof maybeParams;
          const ot = maybeOutput && (maybeOutput as any)._def ? "zod" : typeof maybeOutput;
          const iparse = it === "zod" && typeof (maybeParams as any).parse === "function";
          const oparse = ot === "zod" && typeof (maybeOutput as any).parse === "function";
          const ik = it === "object" ? Object.keys(maybeParams || {}).length : 0;
          const ok = ot === "object" ? Object.keys(maybeOutput || {}).length : 0;
          // debug removed
        } catch {}
        if (maybeParams || maybeOutput) {
          try {
            // debug removed
            const res = (mcp as any).registerTool(
              fq,
              {
                description,
                inputSchema: maybeParams,
                outputSchema: maybeOutput,
              },
              async (...handlerArgs: any[]) => {
                try {
                  return await (cb as any)(...handlerArgs);
                } catch (e: any) {
                  throw e;
                }
              },
            );
            // debug removed
            return res;
          } catch (e: any) {
            // debug removed
            throw e;
          }
        }
        return (mcp as any).tool(fq, description, cb);
      };

      registerWith(async (args: any, extra: any) => {
        // Concurrency gate
        let done: (() => void) | null = null;
        try {
          if (maxConcurrent) done = await acquire();
        } catch (e: any) {
          return {
            isError: true,
            type: "error",
            structuredContent: undefined,
            error: { type: "Error", message: String(e?.message || "Server busy") },
          } as any;
        }
        try {
          const explicitId = extra?.request?.id as any;
          const reqId =
            explicitId ?? (extra && (extra.relatedRequestId ?? extra.id ?? extra.requestId));
          const k = reqId !== undefined ? keyForId(reqId) : undefined;
          if (k !== undefined && !inflight.has(k)) inflight.set(k, { cancelled: false });
          if (cancelAll || (k !== undefined && inflight.get(k)?.cancelled)) {
            return {
              isError: true,
              type: "error",
              structuredContent: undefined,
              error: { type: "Cancelled", message: "cancelled" },
            } as any;
          }
          // Hold permit briefly for concurrency testing if configured
          try {
            const d = Number(process.env.JIO_MCP_TEST_DELAY_MS || "0");
            if (Number.isFinite(d) && d > 0) await new Promise((r) => setTimeout(r, d));
          } catch {}
          // Strip non-schema meta keys before validation
          const argsForValidation = args && typeof args === "object" ? { ...args } : args;
          if (argsForValidation && typeof argsForValidation === "object") {
            delete (argsForValidation as any).signal;
            delete (argsForValidation as any).sessionId;
            delete (argsForValidation as any).sendNotification;
            delete (argsForValidation as any).sendRequest;
            delete (argsForValidation as any).progressToken;
            if (allowedKeys) {
              for (const k of Object.keys(argsForValidation)) {
                if (!allowedKeys.has(k)) delete (argsForValidation as any)[k];
              }
            }
          }
          if (validateIn && !validateIn(argsForValidation)) {
            const err = (validateIn.errors && validateIn.errors[0]) || { message: "invalid" };
            if (process.env.JIO_MCP_ELICIT === "1") {
              const missing = (err as any)?.params?.missingProperty;
              const payload = {
                ajvError: err,
                elicit: {
                  message: "Input validation failed; provide missing/invalid fields and retry.",
                  missingProperty: missing,
                  instancePath: (err as any)?.instancePath || "",
                  schemaPath: (err as any)?.schemaPath || "",
                },
              };
              return {
                isError: true,
                type: "error",
                error: { type: "InvalidInput", message: JSON.stringify(payload) },
              } as any;
            }
            return {
              isError: true,
              type: "error",
              error: { type: "InvalidInput", message: JSON.stringify(err) },
            } as any;
          }
          // Use stdout control or forced elicitation as appropriate.
          const specPath = (index as Map<string, string>).get(fq);
          if (!specPath)
            return {
              isError: true,
              type: "error",
              error: { type: "NotFound", message: "spec not found" },
            } as any;
          const invObj = args ?? {};
          const forcedElicit = undefined as any;
          const ignoreCtl = spec.command?.ignoreControlMessages === true;
          // If client provided an elicitation response up front, skip the initial run and go straight
          // to the second run with augmented invocation.
          if (false && !ignoreCtl) {
            const invObj2 = { ...(args ?? {}) };
            const out2 = new PassThrough();
            const err2 = new PassThrough();
            let outTxt = "";
            let errTxt = "";
            out2.on("data", (b) => (outTxt += Buffer.from(b as any).toString("utf8")));
            err2.on("data", (b) => (errTxt += Buffer.from(b as any).toString("utf8")));
            const code2 = await runWithTransforms(
              dir,
              specPath as string,
              spec as any,
              buildArgv(spec as any, invObj2),
              cfg as any,
              invObj2,
              {
                collect: true,
                collectLimit: opts.collectLimit,
                limits: {
                  collectItems: (opts.maxItemsPerCall as any) ?? opts.collectLimit,
                  collectBytes: (opts.maxCollectBytes as any) ?? opts.collectBytes,
                  maxArgvTokens: opts.maxArgvTokens as any,
                  maxArgvBytes: opts.maxArgvBytes as any,
                  maxStdinBytes: opts.maxStdinBytes as any,
                  maxStdoutJsonBytes: opts.maxStdoutJsonBytes as any,
                  maxNdjsonLineBytes: opts.maxNdjsonLineBytes as any,
                },
                timeoutMsOverride: opts.timeoutMs,
                cleanEnv: opts.cleanEnv !== false,
                passEnv: opts.passEnv || [],
                setEnv: opts.setEnv || {},
                stdoutTarget: out2 as any,
                stderrTarget: err2 as any,
                inputSource: new PassThrough() as any,
                isCancelled: () => false,
              } as any,
            );
            if (code2 && code2 !== 0) return mapExit(code2);
            try {
              const obj2 = outTxt ? JSON.parse(outTxt) : null;
              return { structuredContent: obj2 } as any;
            } catch {
              return {
                isError: true,
                structuredContent: undefined,
                content: [{ type: "text", text: errTxt || "invalid JSON output" }],
              } as any;
            }
          }
          let argv: string[];
          try {
            argv = buildArgv(spec as any, invObj);
          } catch (e: any) {
            return {
              isError: true,
              type: "error",
              error: { type: "ConfigError", message: String(e?.message || e) },
            } as any;
          }
          // Progressive NDJSON streaming over HTTP: when stdout is NDJSON and JSON fallback is not forced,
          // stream each item as an MCP notification and also accumulate items for the final structuredContent.
          const forceJsonResp = process.env.JIO_MCP_HTTP_JSON_RESPONSE === "1";
          const isNdjson = spec.command?.stdoutTransform?.format === "ndjson";
          const shouldStreamNdjson = isNdjson && !forceJsonResp;
          const outStream = new PassThrough();
          const errStream = new PassThrough();
          const inStream = new PassThrough();
          let out = "";
          let err = "";
          // When streaming, parse lines and emit item notifications as they arrive.
          let lineBuf = "";
          const streamedItems: any[] = [];
          let sawCtl = false as boolean;
          let ctlPayload: any = null;
          let ctlState: any = null;
          const notifyItem = (obj: any) => {
            try {
              if ((mcp as any).server?.notification) {
                (mcp as any).server.notification({
                  method: "notifications/item",
                  params: { item: obj },
                });
              }
            } catch {}
          };
          if (!shouldStreamNdjson) {
            //
            outStream.on("data", (b) => (out += Buffer.from(b as any).toString("utf8")));
          }
          // Disable outputSchema on the first run to allow control messages; preserve original stdoutTransform
          const origFmt = (spec.command as any)?.stdoutTransform?.format;
          const specForRun = {
            ...spec,
            tool: { ...(spec.tool || {}), outputSchema: undefined },
            command: {
              ...(spec.command || {}),
              stdoutTransform:
                origFmt === "json" && !((spec.command as any)?.ignoreControlMessages === true)
                  ? ({ shell: "cat", format: "ndjson" } as any)
                  : ((spec.command as any)?.stdoutTransform as any) ||
                    ({ shell: "cat", format: "ndjson" } as any),
            },
          } as any;
          // Custom NDJSON sink to ensure all writes are observed before returning.
          // Build a collector if we stream NDJSON or if we force NDJSON for the first run.
          const firstRunNdjson = (() => {
            try {
              return (specForRun as any)?.command?.stdoutTransform?.format === "ndjson";
            } catch {
              return false;
            }
          })();
          const teeTarget: Writable | null = firstRunNdjson
            ? new Writable({
                write(chunk, _enc, cb) {
                  try {
                    const part = Buffer.from(chunk as any).toString("utf8");
                    out += part;
                    lineBuf += part;
                    while (true) {
                      const nl = lineBuf.indexOf("\n");
                      if (nl < 0) break;
                      let line = lineBuf.slice(0, nl);
                      lineBuf = lineBuf.slice(nl + 1);
                      const s = line.trim();
                      const s2 = (() => {
                        let t = s;
                        if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
                        t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
                        t = t.replace(/[\u0080-\u009F]/g, "");
                        t = t.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
                        t = t.replace(/[\u2028\u2029]/g, "");
                        t = t.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, "");
                        return t;
                      })();
                      if (!s) continue;
                      try {
                        let obj: any = JSON.parse(s2);
                        if (typeof obj === "string") {
                          try {
                            obj = JSON.parse(obj);
                          } catch {}
                        }
                        if (typeof obj !== "object" || obj == null) {
                          throw new Error("not object");
                        }
                        if (obj && typeof obj === "object" && obj["$jio.ctl"] === true) {
                          if (obj["$jio.ctl.elicit"]) {
                            ctlPayload = obj["$jio.ctl.elicit"];
                            ctlState = obj["$jio.ctl.elicit"]?.state;
                            sawCtl = true;
                            if (!ignoreCtl && k !== undefined) inflight.set(k, { cancelled: true });
                            continue;
                          }
                        }
                        streamedItems.push(obj);
                        notifyItem(obj);
                      } catch {
                        // Fallback: try to salvage JSON object substring
                        try {
                          const i0 = s2.indexOf("{");
                          const i1 = s2.lastIndexOf("}");
                          if (i0 >= 0 && i1 > i0) {
                            const inner = s2.slice(i0, i1 + 1);
                            let obj: any = JSON.parse(inner);
                            if (typeof obj === "string") {
                              try {
                                obj = JSON.parse(obj);
                              } catch {}
                            }
                            if (obj && typeof obj === "object" && obj["$jio.ctl"] === true) {
                              if (obj["$jio.ctl.elicit"]) {
                                ctlPayload = obj["$jio.ctl.elicit"];
                                ctlState = obj["$jio.ctl.elicit"]?.state;
                                sawCtl = true;
                                if (!ignoreCtl && k !== undefined)
                                  inflight.set(k, { cancelled: true });
                                continue;
                              }
                            }
                            streamedItems.push(obj);
                            notifyItem(obj);
                          }
                        } catch {}
                        // Heuristic: detect control without full JSON parse, then extract elicit payload
                        try {
                          if (s2.includes('"$jio.ctl"') && s2.includes('"$jio.ctl.elicit"')) {
                            const key = '"$jio.ctl.elicit"';
                            const kpos = s2.indexOf(key);
                            if (kpos >= 0) {
                              const colon = s2.indexOf(":", kpos + key.length);
                              if (colon > 0) {
                                let i = colon + 1;
                                while (i < s2.length && s2[i] !== "{") i++;
                                if (i < s2.length) {
                                  let depth = 0;
                                  let j = i;
                                  for (; j < s2.length; j++) {
                                    const ch = s2[j];
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
                                    const payloadStr = s2.slice(i, j);
                                    try {
                                      const payload = JSON.parse(payloadStr);
                                      ctlPayload = payload;
                                      sawCtl = true;
                                      if (!ignoreCtl && k !== undefined)
                                        inflight.set(k, { cancelled: true });
                                      continue;
                                    } catch {}
                                  }
                                }
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
                final(cb) {
                  try {
                    const trailing = lineBuf.trim();
                    if (trailing) {
                      try {
                        const sanitized = (() => {
                          let t = trailing;
                          if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
                          t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
                          t = t.replace(/[\u0080-\u009F]/g, "");
                          t = t.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
                          t = t.replace(/[\u2028\u2029]/g, "");
                          t = t.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, "");
                          return t;
                        })();
                        const parsed = JSON.parse(sanitized);
                        if (Array.isArray(parsed)) {
                          for (const obj of parsed) {
                            if (
                              obj &&
                              typeof obj === "object" &&
                              obj["$jio.ctl"] === true &&
                              obj["$jio.ctl.elicit"]
                            ) {
                              ctlPayload = obj["$jio.ctl.elicit"];
                              ctlState = obj["$jio.ctl.elicit"]?.state;
                              sawCtl = true;
                              continue;
                            }
                            streamedItems.push(obj);
                            notifyItem(obj);
                          }
                        } else if (
                          !ignoreCtl &&
                          parsed &&
                          typeof parsed === "object" &&
                          parsed["$jio.ctl"] === true &&
                          parsed["$jio.ctl.elicit"]
                        ) {
                          ctlPayload = parsed["$jio.ctl.elicit"];
                          ctlState = parsed["$jio.ctl.elicit"]?.state;
                          sawCtl = true;
                        } else {
                          streamedItems.push(parsed);
                          notifyItem(parsed);
                        }
                      } catch {}
                    }
                  } finally {
                    cb();
                  }
                },
              })
            : null;
          const ndjsonSink: Writable | null = shouldStreamNdjson
            ? new Writable({
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
                        const obj = JSON.parse(s);
                        if (
                          !ignoreCtl &&
                          obj &&
                          typeof obj === "object" &&
                          obj["$jio.ctl"] === true
                        ) {
                          if (obj["$jio.ctl.elicit"]) {
                            ctlPayload = obj["$jio.ctl.elicit"];
                            ctlState = obj["$jio.ctl.elicit"]?.state;
                            sawCtl = true;
                            if (k !== undefined) inflight.set(k, { cancelled: true });
                            continue;
                          }
                        }
                        streamedItems.push(obj);
                        notifyItem(obj);
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
                        let obj: any = JSON.parse(trailing);
                        if (typeof obj === "string") {
                          try {
                            obj = JSON.parse(obj);
                          } catch {}
                        }
                        if (
                          !ignoreCtl &&
                          obj &&
                          typeof obj === "object" &&
                          obj["$jio.ctl"] === true
                        ) {
                          if (obj["$jio.ctl.elicit"]) {
                            ctlPayload = obj["$jio.ctl.elicit"];
                            ctlState = obj["$jio.ctl.elicit"]?.state;
                            sawCtl = true;
                            // Do not cancel here; finalization is already happening
                          }
                        } else {
                          streamedItems.push(obj);
                          notifyItem(obj);
                        }
                      } catch {}
                    }
                  } finally {
                    cb();
                  }
                },
              })
            : null;
          errStream.on("data", (b) => (err += Buffer.from(b as any).toString("utf8")));
          const progressToken = undefined as any;
          const code = await runWithTransforms(
            dir,
            specPath as string,
            specForRun as any,
            argv,
            cfg as any,
            invObj,
            {
              // Force per-line writes to stdoutTarget on first run so teeTarget can see control
              collect: false,
              collectLimit: opts.collectLimit,
              limits: {
                collectItems: (opts.maxItemsPerCall as any) ?? opts.collectLimit,
                collectBytes: (opts.maxCollectBytes as any) ?? opts.collectBytes,
                maxArgvTokens: opts.maxArgvTokens as any,
                maxArgvBytes: opts.maxArgvBytes as any,
                maxStdinBytes: opts.maxStdinBytes as any,
                maxStdoutJsonBytes: opts.maxStdoutJsonBytes as any,
                maxNdjsonLineBytes: opts.maxNdjsonLineBytes as any,
              },
              timeoutMsOverride: opts.timeoutMs,
              cleanEnv: opts.cleanEnv !== false,
              passEnv: opts.passEnv || [],
              setEnv: opts.setEnv || {},
              stdoutTarget: (teeTarget as any) || (ndjsonSink as any) || (outStream as any),
              stderrTarget: errStream as any,
              inputSource: inStream as any,
              isCancelled: () =>
                cancelAll || (k !== undefined && inflight.get(k)?.cancelled) || false,
              onProgress:
                progressToken && process.env.JIO_MCP_PROGRESS !== "0"
                  ? (info: {
                      items?: number;
                      bytes?: number;
                      message?: string;
                      progress?: number;
                    }) => {
                      try {
                        if ((mcp as any).server?.notification) {
                          (mcp as any).server.notification({
                            method: "notifications/progress",
                            params: {
                              progress: info.progress ?? undefined,
                              message: info.message || undefined,
                              progressToken,
                            },
                          });
                        }
                      } catch {}
                    }
                  : undefined,
            } as any,
          );
          // Allow brief time for stderr to flush debug lines from runner, then try fallback parse
          if (!ignoreCtl && !sawCtl) {
            try {
              await new Promise((r) => setTimeout(r, 200));
            } catch {}
          }
          // Second chance delay for JSON previews to flush
          if (!ignoreCtl && !sawCtl) {
            try {
              await new Promise((r) => setTimeout(r, 100));
            } catch {}
          }
          // Fallback: if runner reported preview lines in stderr, try to parse them for control
          if (!ignoreCtl && !sawCtl && err) {
            try {
              const MARK = "RUNNER_NDJSON_INVALID_LINE_NOT_USED ";
              const MARK2 = "RUNNER_NDJSON_LINE_NOT_USED ";
              const MARK_JSON = "RUNNER_JSON_INVALID_PREVIEW_NOT_USED ";
              const lines = err.split(/\r?\n/);
              for (let i = 0; i < lines.length; i++) {
                const ln = lines[i];
                let js: string | null = null;
                let j = ln.indexOf(MARK);
                if (j >= 0) js = ln.slice(j + MARK.length).trim();
                if (!js) {
                  j = ln.indexOf(MARK2);
                  if (j >= 0) {
                    // js is a JSON string containing the raw line; parse twice
                    const s1 = ln.slice(j + MARK2.length).trim();
                    try {
                      const raw = JSON.parse(s1);
                      if (typeof raw === "string") js = raw;
                    } catch {}
                  }
                }
                if (!js) {
                  j = ln.indexOf(MARK_JSON);
                  if (j >= 0) js = ln.slice(j + MARK_JSON.length).trim();
                }
                if (js) {
                  try {
                    // Sanitize before parsing to remove any hidden control characters
                    let t = js;
                    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
                    t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
                    t = t.replace(/[\u0080-\u009F]/g, "");
                    t = t.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
                    t = t.replace(/[\u2028\u2029]/g, "");
                    t = t.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, "");
                    let obj: any;
                    try {
                      obj = JSON.parse(t);
                    } catch {
                      // salvage JSON object substring
                      const i0 = t.indexOf("{");
                      const i1 = t.lastIndexOf("}");
                      if (i0 >= 0 && i1 > i0) obj = JSON.parse(t.slice(i0, i1 + 1));
                    }
                    if (obj && typeof obj === "object" && obj["$jio.ctl"] === true) {
                      if (obj["$jio.ctl.elicit"]) {
                        ctlPayload = obj["$jio.ctl.elicit"];
                        ctlState = obj["$jio.ctl.elicit"]?.state;
                        sawCtl = true;
                        break;
                      }
                    }
                  } catch {}
                }
              }
            } catch {}
          }
          // If we forced NDJSON on first run, parse accumulated `out` lines
          if (firstRunNdjson) {
            for (const line of out.split(/\r?\n/)) {
              const s = line.trim();
              if (!s) continue;
              try {
                const obj = JSON.parse(s);
                if (!ignoreCtl && obj && typeof obj === "object" && obj["$jio.ctl"] === true) {
                  if (obj["$jio.ctl.elicit"]) {
                    ctlPayload = obj["$jio.ctl.elicit"];
                    ctlState = obj["$jio.ctl.elicit"]?.state;
                    sawCtl = true;
                    continue;
                  }
                }
                streamedItems.push(obj);
              } catch {}
            }
          }
          // For JSON-first tools, try parsing full stdout to detect a control object
          if (!ignoreCtl && !sawCtl) {
            try {
              const fmt0 = (specForRun as any)?.command?.stdoutTransform?.format;
              if (fmt0 === "json" && out) {
                const parsed0 = JSON.parse(out);
                if (
                  parsed0 &&
                  typeof parsed0 === "object" &&
                  parsed0["$jio.ctl"] === true &&
                  parsed0["$jio.ctl.elicit"]
                ) {
                  ctlPayload = parsed0["$jio.ctl.elicit"];
                  ctlState = parsed0["$jio.ctl.elicit"]?.state;
                  sawCtl = true;
                }
              }
            } catch {}
          }
          // Handle control observed during first run (streaming or non-streaming)
          if (!ignoreCtl && sawCtl && ctlPayload) {
            try {
              const req = extra?.sendRequest;
              if (typeof req === "function") {
                //
                const { ElicitResultSchema } = await import("@modelcontextprotocol/sdk/types.js");
                const elicitRes = await req(
                  {
                    method: "elicitation/create",
                    params: {
                      message: ctlPayload?.message,
                      requestedSchema: ctlPayload?.requestedSchema,
                    },
                  } as any,
                  ElicitResultSchema as any,
                ).catch(() => null);
                //
                if (elicitRes && elicitRes.action === "accept") {
                  //
                  const invObj2 = {
                    ...(args ?? {}),
                    ["$jio.ctl.elicit.response"]: {
                      action: "accept",
                      content: elicitRes.content || {},
                      state: ctlState,
                    },
                  };
                  const out2 = new PassThrough();
                  const err2 = new PassThrough();
                  let outTxt2 = "";
                  let errTxt2 = "";
                  out2.on("data", (b) => (outTxt2 += Buffer.from(b as any).toString("utf8")));
                  err2.on("data", (b) => (errTxt2 += Buffer.from(b as any).toString("utf8")));
                  //
                  const code2 = await runWithTransforms(
                    dir,
                    specPath as string,
                    spec as any,
                    buildArgv(spec as any, invObj2),
                    cfg as any,
                    invObj2,
                    {
                      collect: true,
                      collectLimit: opts.collectLimit,
                      limits: {
                        collectItems: (opts.maxItemsPerCall as any) ?? opts.collectLimit,
                        collectBytes: (opts.maxCollectBytes as any) ?? opts.collectBytes,
                        maxArgvTokens: opts.maxArgvTokens as any,
                        maxArgvBytes: opts.maxArgvBytes as any,
                        maxStdinBytes: opts.maxStdinBytes as any,
                        maxStdoutJsonBytes: opts.maxStdoutJsonBytes as any,
                        maxNdjsonLineBytes: opts.maxNdjsonLineBytes as any,
                      },
                      timeoutMsOverride: opts.timeoutMs,
                      cleanEnv: opts.cleanEnv !== false,
                      passEnv: opts.passEnv || [],
                      setEnv: opts.setEnv || {},
                      stdoutTarget: out2 as any,
                      stderrTarget: err2 as any,
                      inputSource: new PassThrough() as any,
                      isCancelled: () => false,
                    } as any,
                  );
                  //
                  if (code2 && code2 !== 0) return mapExit(code2);
                  try {
                    const fmt = (spec?.command as any)?.stdoutTransform?.format;
                    let obj2: any = null;
                    if (fmt === "ndjson") {
                      const items: any[] = [];
                      for (const line of String(outTxt2 || "").split(/\r?\n/)) {
                        const s = line.trim();
                        if (!s) continue;
                        try {
                          const o = JSON.parse(s);
                          if (o && typeof o === "object" && o["$jio.ctl"] === true) continue;
                          items.push(o);
                        } catch {}
                      }
                      obj2 = { items };
                    } else {
                      obj2 = outTxt2 ? JSON.parse(outTxt2) : null;
                    }
                    try {
                      if (
                        zodOutForValidation &&
                        typeof (zodOutForValidation as any).parse === "function"
                      ) {
                        (zodOutForValidation as any).parse(obj2);
                      }
                    } catch (e: any) {
                      try {
                        //
                      } catch {}
                    }
                    if (fmt !== "ndjson") {
                      try {
                        const finalObj =
                          registeredOutputKeyCount === 0 && obj2 && typeof obj2 === "object"
                            ? {}
                            : obj2;
                        return { structuredContent: finalObj } as any;
                      } catch {}
                    }
                    return { structuredContent: obj2 } as any;
                  } catch {
                    return {
                      isError: true,
                      content: [{ type: "text", text: errTxt2 || "invalid JSON output" }],
                    } as any;
                  }
                }
                // No acceptance; return a structured error
                return {
                  isError: true,
                  content: [{ type: "text", text: "User declined" }],
                } as any;
              }
            } catch {}
          }
          if (false && !ignoreCtl) {
            const invObj2 = {
              ...(args ?? {}),
              // no meta-driven response at runtime
            };
            const out2 = new PassThrough();
            const err2 = new PassThrough();
            let outTxt = "";
            let errTxt = "";
            out2.on("data", (b) => (outTxt += Buffer.from(b as any).toString("utf8")));
            err2.on("data", (b) => (errTxt += Buffer.from(b as any).toString("utf8")));
            const code2 = await runWithTransforms(
              dir,
              specPath as string,
              spec as any,
              buildArgv(spec as any, invObj2),
              cfg as any,
              invObj2,
              {
                collect: true,
                collectLimit: opts.collectLimit,
                limits: {
                  collectItems: (opts.maxItemsPerCall as any) ?? opts.collectLimit,
                  collectBytes: (opts.maxCollectBytes as any) ?? opts.collectBytes,
                  maxArgvTokens: opts.maxArgvTokens as any,
                  maxArgvBytes: opts.maxArgvBytes as any,
                  maxStdinBytes: opts.maxStdinBytes as any,
                  maxStdoutJsonBytes: opts.maxStdoutJsonBytes as any,
                  maxNdjsonLineBytes: opts.maxNdjsonLineBytes as any,
                },
                timeoutMsOverride: opts.timeoutMs,
                cleanEnv: opts.cleanEnv !== false,
                passEnv: opts.passEnv || [],
                setEnv: opts.setEnv || {},
                stdoutTarget: out2 as any,
                stderrTarget: err2 as any,
                inputSource: new PassThrough() as any,
                isCancelled: () => false,
              } as any,
            );
            if (code2 && code2 !== 0) return mapExit(code2);
            try {
              const fmt = (spec?.command as any)?.stdoutTransform?.format;
              if (fmt === "ndjson") {
                const items: any[] = [];
                for (const line of outTxt.split(/\r?\n/)) {
                  const s = line.trim();
                  if (!s) continue;
                  try {
                    items.push(JSON.parse(s));
                  } catch {}
                }
                if (opts.streamingFinalAggregate) return { structuredContent: { items } } as any;
                return { structuredContent: undefined } as any;
              }
              const obj2 = outTxt ? JSON.parse(outTxt) : null;
              return { structuredContent: obj2 } as any;
            } catch {
              return {
                isError: true,
                type: "error",
                error: { type: "TransformError", message: errTxt || "invalid JSON output" },
              } as any;
            }
          }
          if (shouldStreamNdjson && !ignoreCtl && sawCtl && ctlPayload) {
            try {
              // no pre-supplied response path; always ask client
              const useRes: any = null;
              if (false) {
                const invObj2 = {
                  ...(args ?? {}),
                  ["$jio.ctl.elicit.response"]: {
                    action: "accept",
                    content: {},
                    state: ctlState,
                  },
                };
                const out2 = new PassThrough();
                const err2 = new PassThrough();
                let outTxt = "";
                let errTxt = "";
                out2.on("data", (b) => (outTxt += Buffer.from(b as any).toString("utf8")));
                err2.on("data", (b) => (errTxt += Buffer.from(b as any).toString("utf8")));
                const code2 = await runWithTransforms(
                  dir,
                  specPath as string,
                  spec as any,
                  buildArgv(spec as any, invObj2),
                  cfg as any,
                  invObj2,
                  {
                    collect: true,
                    collectLimit: opts.collectLimit,
                    limits: {
                      collectItems: (opts.maxItemsPerCall as any) ?? opts.collectLimit,
                      collectBytes: (opts.maxCollectBytes as any) ?? opts.collectBytes,
                      maxArgvTokens: opts.maxArgvTokens as any,
                      maxArgvBytes: opts.maxArgvBytes as any,
                      maxStdinBytes: opts.maxStdinBytes as any,
                      maxStdoutJsonBytes: opts.maxStdoutJsonBytes as any,
                      maxNdjsonLineBytes: opts.maxNdjsonLineBytes as any,
                    },
                    timeoutMsOverride: opts.timeoutMs,
                    cleanEnv: opts.cleanEnv !== false,
                    passEnv: opts.passEnv || [],
                    setEnv: opts.setEnv || {},
                    stdoutTarget: out2 as any,
                    stderrTarget: err2 as any,
                    inputSource: new PassThrough() as any,
                    isCancelled: () => false,
                  } as any,
                );
                if (code2 && code2 !== 0) return mapExit(code2);
                try {
                  const fmt = (spec?.command as any)?.stdoutTransform?.format;
                  if (fmt === "ndjson") {
                    const items: any[] = [];
                    for (const line of outTxt.split(/\r?\n/)) {
                      const s = line.trim();
                      if (!s) continue;
                      try {
                        items.push(JSON.parse(s));
                      } catch {}
                    }
                    if (opts.streamingFinalAggregate)
                      return { structuredContent: { items } } as any;
                    return { structuredContent: undefined } as any;
                  }
                  const obj2 = outTxt ? JSON.parse(outTxt) : null;
                  return { structuredContent: obj2 } as any;
                } catch {
                  return {
                    isError: true,
                    type: "error",
                    error: { type: "TransformError", message: errTxt || "invalid JSON output" },
                  } as any;
                }
              }
              const req = extra?.sendRequest;
              if (typeof req === "function") {
                //
                const elicitRes = await req("elicitation/create", {
                  message: ctlPayload?.message,
                  requestedSchema: ctlPayload?.requestedSchema,
                }).catch(() => null);
                //
                if (elicitRes && elicitRes.action === "accept") {
                  const invObj2 = {
                    ...(args ?? {}),
                    ["$jio.ctl.elicit.response"]: {
                      action: "accept",
                      content: elicitRes.content || {},
                      state: ctlState,
                    },
                  };
                  const out2 = new PassThrough();
                  const err2 = new PassThrough();
                  let outTxt = "";
                  let errTxt = "";
                  out2.on("data", (b) => (outTxt += Buffer.from(b as any).toString("utf8")));
                  err2.on("data", (b) => (errTxt += Buffer.from(b as any).toString("utf8")));
                  const code2 = await runWithTransforms(
                    dir,
                    specPath as string,
                    spec as any,
                    buildArgv(spec as any, invObj2),
                    cfg as any,
                    invObj2,
                    {
                      collect: true,
                      collectLimit: opts.collectLimit,
                      limits: {
                        collectItems: (opts.maxItemsPerCall as any) ?? opts.collectLimit,
                        collectBytes: (opts.maxCollectBytes as any) ?? opts.collectBytes,
                        maxArgvTokens: opts.maxArgvTokens as any,
                        maxArgvBytes: opts.maxArgvBytes as any,
                        maxStdinBytes: opts.maxStdinBytes as any,
                        maxStdoutJsonBytes: opts.maxStdoutJsonBytes as any,
                        maxNdjsonLineBytes: opts.maxNdjsonLineBytes as any,
                      },
                      timeoutMsOverride: opts.timeoutMs,
                      cleanEnv: opts.cleanEnv !== false,
                      passEnv: opts.passEnv || [],
                      setEnv: opts.setEnv || {},
                      stdoutTarget: out2 as any,
                      stderrTarget: err2 as any,
                      inputSource: new PassThrough() as any,
                      isCancelled: () => false,
                    } as any,
                  );
                  //
                  if (code2 && code2 !== 0) return mapExit(code2);
                  try {
                    const obj2 = outTxt ? JSON.parse(outTxt) : null;
                    return { structuredContent: obj2 } as any;
                  } catch {
                    return {
                      isError: true,
                      content: [{ type: "text", text: errTxt || "invalid JSON output" }],
                    } as any;
                  }
                }
                return { isError: true, content: [{ type: "text", text: "User declined" }] } as any;
              }
            } catch {}
            return {
              isError: true,
              content: [{ type: "text", text: "Elicitation unsupported" }],
            } as any;
          }
          if (code && code !== 0) return mapExit(code);
          // Fast-path: when not streaming and ignoring control for NDJSON tools,
          // return raw items. Handle both NDJSON lines and single JSON array output.
          if (!shouldStreamNdjson && ignoreCtl && isNdjson) {
            const parseItems = (txt: string): any[] => {
              // Try full JSON array first
              try {
                const maybe = JSON.parse(txt);
                if (Array.isArray(maybe)) return maybe;
              } catch {}
              // Fallback: parse line-delimited NDJSON
              const parsed: any[] = [];
              for (const line of txt.split(/\r?\n/)) {
                const s = line.trim();
                if (!s) continue;
                try {
                  parsed.push(JSON.parse(s));
                } catch {}
              }
              // If we collected a single array as one line, unwrap it
              if (parsed.length === 1 && Array.isArray(parsed[0])) return parsed[0];
              return parsed;
            };
            const items = parseItems(out);
            if (ignoreCtl || opts.streamingFinalAggregate)
              return { structuredContent: { items } } as any;
            return { structuredContent: undefined } as any;
          }
          try {
            const ignoreCtl = spec.command?.ignoreControlMessages === true;
            let obj: any = null;
            if (shouldStreamNdjson) {
              if (ignoreCtl) {
                // When ignoring control messages in streaming mode, just return collected items.
                const trailing = lineBuf.trim();
                if (trailing) {
                  try {
                    const o = JSON.parse(trailing);
                    streamedItems.push(o);
                    notifyItem(o);
                  } catch {}
                }
                // Always include items when ignoring control lines
                return { structuredContent: { items: streamedItems.slice() } } as any;
              }
              // If control was observed and we are ignoring control messages, proceed to parse normally.
              // If control was observed and client pre-supplied elicitation, it should have been handled above.
              // Flush trailing line if any
              const trailing = lineBuf.trim();
              if (trailing) {
                try {
                  const o = JSON.parse(trailing);
                  streamedItems.push(o);
                  notifyItem(o);
                } catch {}
              }
              // Enforce server-level item cap for streaming if configured
              try {
                const cap = Number.isFinite(opts.maxItemsPerCall as any)
                  ? (opts.maxItemsPerCall as number)
                  : 0;
                if (cap > 0 && streamedItems.length > cap) {
                  return {
                    isError: true,
                    content: [
                      {
                        type: "text",
                        text: `Server limit exceeded: items>${cap}`,
                      },
                    ],
                  } as any;
                }
              } catch {}
              // For streaming mode, still provide a final structuredContent for convenience.
              obj = streamedItems.slice();
            } else if (out) {
              if (isNdjson) {
                const items: any[] = [];
                let foundCtl: any = null;
                for (const line of out.split(/\r?\n/)) {
                  const s = line.trim();
                  if (!s) continue;
                  try {
                    const o = JSON.parse(s);
                    if (!ignoreCtl && o && typeof o === "object" && o["$jio.ctl"] === true) {
                      if (o["$jio.ctl.elicit"]) foundCtl = o["$jio.ctl.elicit"];
                      continue;
                    }
                    items.push(o);
                  } catch {}
                }
                if (!ignoreCtl && foundCtl) {
                  // Forced acceptance: return collected items directly (tool remains control-only)
                  if (false) {
                    return { structuredContent: { items } } as any;
                  }
                  // Ask client via request channel
                  try {
                    const req = extra?.sendRequest;
                    if (typeof req === "function") {
                      //
                      const elicitRes = await req("elicitation/create", {
                        message: foundCtl?.message,
                        requestedSchema: foundCtl?.requestedSchema,
                      }).catch(() => null);
                      if (elicitRes && elicitRes.action === "accept") {
                        const invObj2 = {
                          ...(args ?? {}),
                          ["$jio.ctl.elicit.response"]: {
                            action: "accept",
                            content: elicitRes.content || {},
                            state: foundCtl?.state,
                          },
                        };
                        const out2 = new PassThrough();
                        const err2 = new PassThrough();
                        let outTxt = "";
                        let errTxt = "";
                        out2.on("data", (b) => (outTxt += Buffer.from(b as any).toString("utf8")));
                        err2.on("data", (b) => (errTxt += Buffer.from(b as any).toString("utf8")));
                        const code2 = await runWithTransforms(
                          dir,
                          specPath as string,
                          spec as any,
                          buildArgv(spec as any, invObj2),
                          cfg as any,
                          invObj2,
                          {
                            collect: true,
                            collectLimit: opts.collectLimit,
                            limits: {
                              collectItems: (opts.maxItemsPerCall as any) ?? opts.collectLimit,
                              collectBytes: (opts.maxCollectBytes as any) ?? opts.collectBytes,
                              maxArgvTokens: opts.maxArgvTokens as any,
                              maxArgvBytes: opts.maxArgvBytes as any,
                              maxStdinBytes: opts.maxStdinBytes as any,
                              maxStdoutJsonBytes: opts.maxStdoutJsonBytes as any,
                              maxNdjsonLineBytes: opts.maxNdjsonLineBytes as any,
                            },
                            timeoutMsOverride: opts.timeoutMs,
                            cleanEnv: opts.cleanEnv !== false,
                            passEnv: opts.passEnv || [],
                            setEnv: opts.setEnv || {},
                            stdoutTarget: out2 as any,
                            stderrTarget: err2 as any,
                            inputSource: new PassThrough() as any,
                            isCancelled: () => false,
                          } as any,
                        );
                        if (code2 && code2 !== 0) return mapExit(code2);
                        try {
                          const items2: any[] = [];
                          for (const ln of outTxt.split(/\r?\n/)) {
                            const s2 = ln.trim();
                            if (!s2) continue;
                            try {
                              items2.push(JSON.parse(s2));
                            } catch {}
                          }
                          if (opts.streamingFinalAggregate)
                            return { structuredContent: { items: items2 } } as any;
                          return { structuredContent: undefined } as any;
                        } catch {
                          return {
                            isError: true,
                            type: "error",
                            error: {
                              type: "TransformError",
                              message: errTxt || "invalid JSON output",
                            },
                          } as any;
                        }
                      }
                      return {
                        isError: true,
                        content: [{ type: "text", text: "User declined" }],
                      } as any;
                    }
                  } catch {}
                  return {
                    isError: true,
                    type: "error",
                    error: { type: "Error", message: "Elicitation unsupported" },
                  } as any;
                }
                // No control or ignoring control: return items
                if (opts.streamingFinalAggregate) return { structuredContent: { items } } as any;
                return { structuredContent: undefined } as any;
              }
              try {
                obj = JSON.parse(out);
              } catch {
                if (ignoreCtl) {
                  const items: any[] = [];
                  for (const line of out.split(/\r?\n/)) {
                    const s = line.trim();
                    if (!s) continue;
                    try {
                      items.push(JSON.parse(s));
                    } catch {}
                  }
                  obj = { items };
                } else {
                  throw new Error("parse");
                }
              }
            }
            if (!ignoreCtl && obj != null) {
              // Control detection: NDJSON (array) or JSON (object)
              const isCtlObj = (o: any) => o && typeof o === "object" && o["$jio.ctl"] === true;
              if (Array.isArray(obj)) {
                const ctl = obj.find((o) => isCtlObj(o));
                if (ctl && ctl["$jio.ctl.elicit"]) {
                  try {
                    if (forcedElicit && forcedElicit.action === "accept") {
                      const invObj2 = {
                        ...(args ?? {}),
                        ["$jio.ctl.elicit.response"]: {
                          action: "accept",
                          content: forcedElicit.content || {},
                          state: ctl["$jio.ctl.elicit"]?.state,
                        },
                      };
                      const out2 = new PassThrough();
                      const err2 = new PassThrough();
                      let outTxt = "";
                      let errTxt = "";
                      out2.on("data", (b) => (outTxt += Buffer.from(b as any).toString("utf8")));
                      err2.on("data", (b) => (errTxt += Buffer.from(b as any).toString("utf8")));
                      const code2 = await runWithTransforms(
                        dir,
                        specPath as string,
                        spec as any,
                        buildArgv(spec as any, invObj2),
                        cfg as any,
                        invObj2,
                        {
                          collect: true,
                          collectLimit: opts.collectLimit,
                          limits: {
                            collectItems: (opts.maxItemsPerCall as any) ?? opts.collectLimit,
                            collectBytes: (opts.maxCollectBytes as any) ?? opts.collectBytes,
                            maxArgvTokens: opts.maxArgvTokens as any,
                            maxArgvBytes: opts.maxArgvBytes as any,
                            maxStdinBytes: opts.maxStdinBytes as any,
                            maxStdoutJsonBytes: opts.maxStdoutJsonBytes as any,
                            maxNdjsonLineBytes: opts.maxNdjsonLineBytes as any,
                          },
                          timeoutMsOverride: opts.timeoutMs,
                          cleanEnv: opts.cleanEnv !== false,
                          passEnv: opts.passEnv || [],
                          setEnv: opts.setEnv || {},
                          stdoutTarget: out2 as any,
                          stderrTarget: err2 as any,
                          inputSource: new PassThrough() as any,
                          isCancelled: () => false,
                        } as any,
                      );
                      if (code2 && code2 !== 0) return mapExit(code2);
                      try {
                        const obj2 = outTxt ? JSON.parse(outTxt) : null;
                        return { structuredContent: obj2 } as any;
                      } catch {
                        return {
                          isError: true,
                          content: [{ type: "text", text: errTxt || "invalid JSON output" }],
                        } as any;
                      }
                    }
                    const req = extra?.sendRequest;
                    if (typeof req === "function") {
                      const { ElicitResultSchema } = await import(
                        "@modelcontextprotocol/sdk/types.js"
                      );
                      const elicitRes =
                        process.env.JIO_MCP_TEST_AUTO_ELICIT === "1"
                          ? ({ action: "accept", content: {} } as any)
                          : await req(
                              {
                                method: "elicitation/create",
                                params: {
                                  message: ctl["$jio.ctl.elicit"]?.message,
                                  requestedSchema: ctl["$jio.ctl.elicit"]?.requestedSchema,
                                },
                              } as any,
                              ElicitResultSchema as any,
                            ).catch(() => null);
                      if (elicitRes && elicitRes.action === "accept") {
                        const invObj2 = {
                          ...(args ?? {}),
                          ["$jio.ctl.elicit.response"]: {
                            action: "accept",
                            content: elicitRes.content || {},
                            state: ctl["$jio.ctl.elicit"]?.state,
                          },
                        };
                        const out2 = new PassThrough();
                        const err2 = new PassThrough();
                        let outTxt = "";
                        let errTxt = "";
                        out2.on("data", (b) => (outTxt += Buffer.from(b as any).toString("utf8")));
                        err2.on("data", (b) => (errTxt += Buffer.from(b as any).toString("utf8")));
                        const code2 = await runWithTransforms(
                          dir,
                          specPath as string,
                          spec as any,
                          buildArgv(spec as any, invObj2),
                          cfg as any,
                          invObj2,
                          {
                            collect: true,
                            collectLimit: opts.collectLimit,
                            limits: {
                              collectItems: (opts.maxItemsPerCall as any) ?? opts.collectLimit,
                              collectBytes: (opts.maxCollectBytes as any) ?? opts.collectBytes,
                              maxArgvTokens: opts.maxArgvTokens as any,
                              maxArgvBytes: opts.maxArgvBytes as any,
                              maxStdinBytes: opts.maxStdinBytes as any,
                              maxStdoutJsonBytes: opts.maxStdoutJsonBytes as any,
                              maxNdjsonLineBytes: opts.maxNdjsonLineBytes as any,
                            },
                            timeoutMsOverride: opts.timeoutMs,
                            cleanEnv: opts.cleanEnv !== false,
                            passEnv: opts.passEnv || [],
                            setEnv: opts.setEnv || {},
                            stdoutTarget: out2 as any,
                            stderrTarget: err2 as any,
                            inputSource: new PassThrough() as any,
                            isCancelled: () => false,
                          } as any,
                        );
                        if (code2 && code2 !== 0) return mapExit(code2);
                        try {
                          const obj2 = outTxt ? JSON.parse(outTxt) : null;
                          return { structuredContent: obj2 } as any;
                        } catch {
                          return {
                            isError: true,
                            content: [{ type: "text", text: errTxt || "invalid JSON output" }],
                          } as any;
                        }
                      }
                      return {
                        isError: true,
                        content: [{ type: "text", text: "User declined" }],
                      } as any;
                    }
                  } catch {}
                  return {
                    isError: true,
                    content: [{ type: "text", text: "Elicitation unsupported" }],
                  } as any;
                }
              } else if (isCtlObj(obj) && obj["$jio.ctl.elicit"]) {
                try {
                  const req = extra?.sendRequest;
                  if (typeof req === "function") {
                    const { ElicitResultSchema } = await import(
                      "@modelcontextprotocol/sdk/types.js"
                    );
                    const elicitRes =
                      process.env.JIO_MCP_TEST_AUTO_ELICIT === "1"
                        ? ({ action: "accept", content: {} } as any)
                        : await req(
                            {
                              method: "elicitation/create",
                              params: {
                                message: obj["$jio.ctl.elicit"]?.message,
                                requestedSchema: obj["$jio.ctl.elicit"]?.requestedSchema,
                              },
                            } as any,
                            ElicitResultSchema as any,
                          ).catch(() => null);
                    if (elicitRes && elicitRes.action === "accept") {
                      const invObj2 = {
                        ...(args ?? {}),
                        ["$jio.ctl.elicit.response"]: {
                          action: "accept",
                          content: elicitRes.content || {},
                          state: obj["$jio.ctl.elicit"]?.state,
                        },
                      };
                      const out2 = new PassThrough();
                      const err2 = new PassThrough();
                      let outTxt = "";
                      let errTxt = "";
                      out2.on("data", (b) => (outTxt += Buffer.from(b as any).toString("utf8")));
                      err2.on("data", (b) => (errTxt += Buffer.from(b as any).toString("utf8")));
                      const code2 = await runWithTransforms(
                        dir,
                        specPath as string,
                        spec as any,
                        buildArgv(spec as any, invObj2),
                        cfg as any,
                        invObj2,
                        {
                          collect: true,
                          collectLimit: opts.collectLimit,
                          limits: {
                            collectItems: (opts.maxItemsPerCall as any) ?? opts.collectLimit,
                            collectBytes: (opts.maxCollectBytes as any) ?? opts.collectBytes,
                            maxArgvTokens: opts.maxArgvTokens as any,
                            maxArgvBytes: opts.maxArgvBytes as any,
                            maxStdinBytes: opts.maxStdinBytes as any,
                            maxStdoutJsonBytes: opts.maxStdoutJsonBytes as any,
                            maxNdjsonLineBytes: opts.maxNdjsonLineBytes as any,
                          },
                          timeoutMsOverride: opts.timeoutMs,
                          cleanEnv: opts.cleanEnv !== false,
                          passEnv: opts.passEnv || [],
                          setEnv: opts.setEnv || {},
                          stdoutTarget: out2 as any,
                          stderrTarget: err2 as any,
                          inputSource: new PassThrough() as any,
                          isCancelled: () => false,
                        } as any,
                      );
                      if (code2 && code2 !== 0) return mapExit(code2);
                      try {
                        const obj2 = outTxt ? JSON.parse(outTxt) : null;
                        return { structuredContent: obj2 } as any;
                      } catch {
                        return {
                          isError: true,
                          content: [{ type: "text", text: errTxt || "invalid JSON output" }],
                        } as any;
                      }
                    }
                    return {
                      isError: true,
                      content: [{ type: "text", text: "User declined" }],
                    } as any;
                  }
                } catch {}
                return {
                  isError: true,
                  content: [{ type: "text", text: "Elicitation unsupported" }],
                } as any;
              }
            }
            if (!ignoreCtl && validateOut && obj != null && !shouldStreamNdjson) {
              const ok = validateOut(obj);
              if (!ok) {
                const verr = (validateOut.errors && validateOut.errors[0]) || {
                  message: "invalid",
                };
                return {
                  isError: true,
                  content: [{ type: "text", text: JSON.stringify(verr) }],
                } as any;
              }
            }
            if (cancelAll || (k !== undefined && inflight.get(k)?.cancelled)) {
              return {
                isError: true,
                type: "error",
                structuredContent: undefined,
                error: { type: "Cancelled", message: "cancelled" },
              } as any;
            }
            // optional progress completion notice if client requested and no control
            try {
              if (process.env.JIO_MCP_PROGRESS !== "0") {
                try {
                  // only send if token supplied; use untyped send to avoid schema parse typing
                  const token = undefined as any;
                  if (token && (mcp as any).server?.notification) {
                    await (mcp as any).server.notification({
                      method: "notifications/progress",
                      params: { progress: 1, message: "done", progressToken: token },
                    });
                  }
                } catch {}
              }
            } catch {}
            const payload = Array.isArray(obj) ? { items: obj } : obj;
            return { structuredContent: payload } as any;
          } catch {
            return {
              isError: true,
              content: [{ type: "text", text: err || "invalid JSON output" }],
            } as any;
          }
        } catch (e: any) {
          return {
            isError: true,
            content: [{ type: "text", text: String(e?.message || e) }],
          } as any;
        } finally {
          try {
            if (done) done();
          } catch {}
          try {
            const explicitId = extra?.request?.id as any;
            const reqId =
              explicitId ?? (extra && (extra.relatedRequestId ?? extra.id ?? extra.requestId));
            if (reqId !== undefined) inflight.delete(keyForId(reqId));
          } catch {}
        }
      });
    }

    // DNS rebinding protection (allowlist)
    const defaultAllowedHosts = [
      `${host}:${port}`,
      `localhost:${port}`,
      host === "127.0.0.1" ? `127.0.0.1:${port}` : undefined,
    ].filter(Boolean) as string[];
    const allowedHosts = (process.env.JIO_HTTP_ALLOWED_HOSTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const allowedOrigins = (process.env.JIO_HTTP_ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const forceJson = process.env.JIO_MCP_HTTP_JSON_RESPONSE === "1";
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      enableJsonResponse: !!forceJson,
      enableDnsRebindingProtection: true,
      allowedHosts: allowedHosts.length ? allowedHosts : defaultAllowedHosts,
      allowedOrigins: allowedOrigins.length ? allowedOrigins : undefined,
      enableCookies: true,
    } as any);
    // wrap transport send and error to trace message flow
    try {
      const origSend = (transport as any).send?.bind(transport);
      (transport as any).send = async (message: any, options: any) => {
        try {
          const kind = message?.result
            ? "response"
            : message?.error
              ? "error"
              : message?.method
                ? message.id !== undefined
                  ? "request"
                  : "notification"
                : "unknown";
          const meta = {
            kind,
            id: message?.id,
            method: message?.method,
            related: options?.relatedRequestId,
            errorCode: message?.error?.code,
            errorMessage: message?.error?.message,
          };
          //
        } catch {}
        try {
          const kind = message?.result
            ? "response"
            : message?.error
              ? "error"
              : message?.method
                ? message.id !== undefined
                  ? "request"
                  : "notification"
                : "unknown";
          const meta = {
            kind,
            id: message?.id,
            method: message?.method,
            related: options?.relatedRequestId,
            errorCode: message?.error?.code,
            errorMessage: message?.error?.message,
          };
          //
        } catch {}
        return await origSend(message, options);
      };
      const origOnError = (transport as any).onerror?.bind(transport);
      (transport as any).onerror = (err: any) => {
        try {
          //
        } catch {}
        try {
          //
        } catch {}
        try {
          origOnError?.(err);
        } catch {}
      };
    } catch {}
    await mcp.connect(transport as any);

    const resources = new ResourceRegistry(dir);
    await resources.refresh();

    const baseResourcesPath = process.env.JIO_HTTP_RESOURCES_BASE || "/jio/resources";
    const ensureLeading = (p: string) => (p.startsWith("/") ? p : "/" + p);
    const RES_BASE = ensureLeading(baseResourcesPath);

    function sniffMime(p: string, provided?: string | undefined): string {
      if (provided && typeof provided === "string" && provided.trim()) return provided;
      const ext = path.extname(p).toLowerCase();
      if (ext === ".md" || ext === ".markdown") return "text/markdown; charset=utf-8";
      if (ext === ".json") return "application/json; charset=utf-8";
      if (ext === ".txt") return "text/plain; charset=utf-8";
      return "text/plain; charset=utf-8";
    }

    const httpServer = createServer(async (req, res) => {
      try {
        if (req.method === "GET" && req.url === "/health") {
          const body = JSON.stringify({ ok: true });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(body);
          return;
        }
        // Resources index
        if (
          req.method === "GET" &&
          req.url &&
          (req.url === RES_BASE || req.url === RES_BASE + "/")
        ) {
          const list = resources.list();
          const rows: any[] = [];
          for (const r of list) {
            try {
              const meta = await computeResourceMeta(r.absFilePath, {
                etagMode: r.etag === "auto" ? "auto" : "none",
                explicitEtag: r.etag,
              });
              rows.push({
                id: r.id,
                name: r.name,
                mimeType: r.mimeType,
                cacheControl: r.cacheControl,
                size: meta.size,
                etag: meta.etag,
              });
            } catch {
              rows.push({
                id: r.id,
                name: r.name,
                mimeType: r.mimeType,
                cacheControl: r.cacheControl,
              });
            }
          }
          const body = JSON.stringify(rows);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(body);
          return;
        }
        // Resource by id (GET/HEAD)
        if (req.url && (req.url.startsWith(RES_BASE + "/") || req.url === RES_BASE)) {
          const urlPath = req.url.split("?")[0] || "";
          const id = urlPath.slice(RES_BASE.length + 1);
          if (id) {
            const rec = resources.get(id);
            if (!rec) {
              res.statusCode = 404;
              res.end();
              return;
            }
            try {
              const meta = await computeResourceMeta(rec.absFilePath, {
                etagMode: rec.etag === "auto" ? "auto" : "none",
                explicitEtag: rec.etag,
              });
              const etag = meta.etag;
              const ifNone = req.headers["if-none-match"] as any as string | undefined;
              if (etag && ifNone && ifNone === etag && req.method === "GET") {
                res.writeHead(304, { ETag: etag });
                res.end();
                return;
              }
              const mime = sniffMime(rec.absFilePath, rec.mimeType);
              const headers: any = {
                "content-type": mime,
                "cache-control": rec.cacheControl || "no-cache",
                "last-modified": new Date(meta.mtimeMs).toUTCString(),
              };
              if (etag) headers["etag"] = etag;
              if (req.method === "HEAD") {
                headers["content-length"] = String(meta.size);
                res.writeHead(200, headers);
                res.end();
                return;
              }
              if (req.method === "GET") {
                headers["content-length"] = String(meta.size);
                res.writeHead(200, headers);
                const rs = fss.createReadStream(rec.absFilePath);
                rs.on("error", () => {
                  if (!res.headersSent) res.writeHead(500);
                  try {
                    res.end();
                  } catch {}
                });
                rs.pipe(res);
                return;
              }
            } catch {
              res.statusCode = 404;
              res.end();
              return;
            }
          }
        }
        if ((req.url || "").startsWith("/mcp")) {
          await (transport as any).handleRequest(req, res);
          return;
        }
        res.statusCode = 404;
        res.end();
      } catch {
        try {
          res.statusCode = 500;
          res.end();
        } catch {}
      }
    });

    await new Promise<void>((res) => httpServer.listen(port, host, () => res()));
    try {
      process.stderr.write(`jio-mcp: listening on http://${host}:${port}/mcp\n`);
    } catch {}
    return {
      close: async () =>
        new Promise<void>((res, rej) => {
          try {
            httpServer.close((err: any) => (err ? rej(err) : res()));
          } catch {
            res();
          }
        }),
    };
  }
  // default to stdio using MCP SDK
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { dir, cfg, specs, index } = await discoverJioTools();
  const server = new McpServer({ name: "jio-mcp", version: await readVersion() });
  try {
    (server as any).server?.registerCapabilities?.({ tools: {} });
  } catch {}
  const ajv = new Ajv({ strict: true, allErrors: true });
  // PR4: full queue semantics for stdio as well
  const maxConcurrent = Number.isFinite(opts.maxConcurrentCalls as number)
    ? Math.max(0, opts.maxConcurrentCalls as number)
    : 0; // 0 = unlimited
  const queueSize = Number.isFinite(opts.queueSize as number)
    ? Math.max(0, opts.queueSize as number)
    : 0;
  const queueTimeoutMs = Number.isFinite(opts.queueTimeoutMs as number)
    ? Math.max(0, opts.queueTimeoutMs as number)
    : 0;
  let inFlight = 0;
  const waitQueue: Array<{
    res: (v: () => void) => void;
    rej: (e: any) => void;
    t?: NodeJS.Timeout;
  }> = [];
  const release = () => {
    inFlight = Math.max(0, inFlight - 1);
    const next = waitQueue.shift();
    if (next) {
      clearTimeout(next.t as any);
      inFlight++;
      next.res(() => release());
    }
  };
  const acquire = async (): Promise<() => void> => {
    if (!maxConcurrent || inFlight < maxConcurrent) {
      inFlight++;
      return () => release();
    }
    if (waitQueue.length >= queueSize) {
      throw Object.assign(new Error("Server busy"), { code: "ServerBusy" });
    }
    return await new Promise<() => void>((res, rej) => {
      const entry: any = { res, rej };
      if (queueTimeoutMs > 0) {
        entry.t = setTimeout(() => {
          const idx = waitQueue.indexOf(entry);
          if (idx >= 0) waitQueue.splice(idx, 1);
          rej(Object.assign(new Error("Queue timeout"), { code: "QueueTimeout" }));
        }, queueTimeoutMs);
      }
      waitQueue.push(entry);
    });
  };

  for (const [fq, spec] of specs) {
    const inputSchema = spec.tool?.inputSchema || generateInputSchemaFromParameters(spec);
    const description = spec.tool?.description || fq;
    const validateIn = inputSchema ? ajv.compile(inputSchema) : null;
    const outputSchema = spec.tool?.outputSchema || null;
    const validateOut = outputSchema ? ajv.compile(outputSchema) : null;

    let maybeParams: any | undefined = undefined;
    let maybeOutput: any | undefined = undefined;
    let zodOutForValidation: any | null = null;
    if (inputSchema) {
      const conv = await jsonSchemaToZodSafe(inputSchema);
      if (conv.zod) {
        // Convert Zod object to the SDK's expected raw shape (ZodRawShape)
        // The SDK wraps with z.object() internally.
        const shape = getZodRawShape(conv.zod);
        if (shape && typeof shape === "object") {
          maybeParams = shape;
        }
      } else if (conv.reasons && conv.reasons.length) {
        emitZodWarning({ tool: fq, reasons: conv.reasons, schema: inputSchema, kind: "input" });
      }
    }

    if (outputSchema) {
      const conv = await jsonSchemaToZodSafe(outputSchema);
      if (conv.zod) {
        const shape = getZodRawShape(conv.zod);
        if (shape && typeof shape === "object") {
          maybeOutput = shape;
        } else {
          emitZodWarning({
            tool: fq,
            reasons: [{ keyword: "rootType", pointer: "", note: "non-object" }],
            schema: outputSchema,
            kind: "output",
          });
        }
      } else if (conv.reasons && conv.reasons.length) {
        emitZodWarning({ tool: fq, reasons: conv.reasons, schema: outputSchema, kind: "output" });
      }
    }

    const registerWith = (cb: any) => {
      try {
        const it = maybeParams && (maybeParams as any)._def ? "zod" : typeof maybeParams;
        const ot = maybeOutput && (maybeOutput as any)._def ? "zod" : typeof maybeOutput;
        const iparse = it === "zod" && typeof (maybeParams as any).parse === "function";
        const oparse = ot === "zod" && typeof (maybeOutput as any).parse === "function";
        const ik = it === "object" ? Object.keys(maybeParams || {}).length : 0;
        const ok = ot === "object" ? Object.keys(maybeOutput || {}).length : 0;
        const msg = ``;
        process.stderr.write(msg + "\n");
      } catch {}
      if (maybeParams || maybeOutput) {
        return (server as any).registerTool(
          fq,
          {
            description,
            inputSchema: maybeParams,
            outputSchema: maybeOutput,
          },
          cb,
        );
      }
      return (server as any).tool(fq, description, cb);
    };

    registerWith(async (args: any) => {
      let done: (() => void) | null = null;
      try {
        if (maxConcurrent) done = await acquire();
        const argsForValidation = args && typeof args === "object" ? { ...args } : args;
        let allowedKeys: Set<string> | null = null;
        if (inputSchema && (inputSchema as any).type === "object") {
          const hasProps = !!(inputSchema as any).properties;
          const addl = (inputSchema as any).additionalProperties;
          if (addl === false) {
            allowedKeys = new Set(Object.keys((inputSchema as any).properties || {}));
          } else if (hasProps) {
            allowedKeys = new Set(Object.keys((inputSchema as any).properties));
          }
        }
        if (argsForValidation && typeof argsForValidation === "object") {
          // purge any private meta keys if present (defensive; server never uses them)
          delete (argsForValidation as any).signal;
          delete (argsForValidation as any).sessionId;
          delete (argsForValidation as any).sendNotification;
          delete (argsForValidation as any).sendRequest;
          delete (argsForValidation as any).progressToken;
          if (allowedKeys) {
            for (const k of Object.keys(argsForValidation)) {
              if (!allowedKeys.has(k)) delete (argsForValidation as any)[k];
            }
          }
        }
        if (validateIn && !validateIn(argsForValidation)) {
          const err = (validateIn.errors && validateIn.errors[0]) || { message: "invalid" };
          if (process.env.JIO_MCP_ELICIT === "1") {
            const missing = (err as any)?.params?.missingProperty;
            const payload = {
              ajvError: err,
              elicit: {
                message: "Input validation failed; provide missing/invalid fields and retry.",
                missingProperty: missing,
                instancePath: (err as any)?.instancePath || "",
                schemaPath: (err as any)?.schemaPath || "",
              },
            };
            return {
              type: "error",
              error: { type: "InvalidInput", message: JSON.stringify(payload) },
            } as any;
          }
          return {
            type: "error",
            error: {
              type: "InvalidInput",
              message: JSON.stringify(err),
            },
          } as any;
        }
        if (process.env.JIO_MCP_ELICIT === "1") {
          const payload = {
            elicit: {
              message: "Please confirm you want to proceed",
              confirmProperty: "confirm",
            },
          };
          return {
            type: "error",
            error: { type: "InvalidInput", message: JSON.stringify(payload) },
          } as any;
        }

        // Use core to build argv and run with transforms, capturing output to avoid polluting MCP stdio.
        const specPath = (index as Map<string, string>).get(fq);
        if (!specPath) {
          return { type: "error", error: { type: "NotFound", message: "spec not found" } } as any;
        }
        const invObj = args ?? {};
        let argv: string[];
        try {
          argv = buildArgv(spec as any, invObj);
        } catch (e: any) {
          return {
            type: "error",
            error: { type: "ConfigError", message: String(e?.message || e) },
          } as any;
        }
        const isNdjson = spec.command?.stdoutTransform?.format === "ndjson";
        const outStream = new PassThrough();
        const errStream = new PassThrough();
        const inStream = new PassThrough();
        let out = "";
        let err = "";
        outStream.on("data", (b) => (out += Buffer.from(b as any).toString("utf8")));
        errStream.on("data", (b) => (err += Buffer.from(b as any).toString("utf8")));
        const code = await runWithTransforms(
          dir,
          specPath as string,
          spec as any,
          argv,
          cfg as any,
          invObj,
          {
            collect: !!isNdjson,
            collectLimit: opts.collectLimit,
            limits: {
              collectItems: (opts.maxItemsPerCall as any) ?? opts.collectLimit,
              collectBytes: (opts.maxCollectBytes as any) ?? opts.collectBytes,
              maxArgvTokens: opts.maxArgvTokens as any,
              maxArgvBytes: opts.maxArgvBytes as any,
              maxStdinBytes: opts.maxStdinBytes as any,
              maxStdoutJsonBytes: opts.maxStdoutJsonBytes as any,
              maxNdjsonLineBytes: opts.maxNdjsonLineBytes as any,
            },
            timeoutMsOverride: opts.timeoutMs,
            cleanEnv: opts.cleanEnv !== false,
            passEnv: opts.passEnv || [],
            setEnv: opts.setEnv || {},
            stdoutTarget: outStream as any,
            stderrTarget: errStream as any,
            inputSource: inStream as any,
          } as any,
        );
        if (code && code !== 0) return mapExit(code);
        try {
          let obj: any = null;
          const ignoreCtl = spec.command?.ignoreControlMessages === true;
          if (out) {
            try {
              obj = JSON.parse(out);
            } catch {
              // Fallback: if ignoring control and NDJSON, parse line-by-line
              if (ignoreCtl && isNdjson) {
                const items: any[] = [];
                for (const line of out.split(/\r?\n/)) {
                  const s = line.trim();
                  if (!s) continue;
                  try {
                    items.push(JSON.parse(s));
                  } catch {}
                }
                obj = { items };
              } else {
                throw new Error("parse");
              }
            }
          }
          if (!ignoreCtl && obj != null) {
            const isCtlObj = (o: any) => o && typeof o === "object" && o["$jio.ctl"] === true;
            if (Array.isArray(obj)) {
              const ctl = obj.find((o) => isCtlObj(o));
              if (ctl && ctl["$jio.ctl.elicit"]) {
                return {
                  type: "error",
                  error: { type: "Error", message: "Elicitation unsupported" },
                } as any;
              }
            } else if (isCtlObj(obj) && obj["$jio.ctl.elicit"]) {
              return {
                type: "error",
                error: { type: "Error", message: "Elicitation unsupported" },
              } as any;
            }
          }
          if (!ignoreCtl && validateOut && obj != null) {
            const ok = validateOut(obj);
            if (!ok) {
              const err = (validateOut.errors && validateOut.errors[0]) || { message: "invalid" };
              return {
                isError: true,
                content: [{ type: "text", text: JSON.stringify(err) }],
              } as any;
            }
          }
          // For NDJSON tools, wrap collected array in an object for MCP structuredContent
          const payload = isNdjson && Array.isArray(obj) ? { items: obj } : obj;
          return { structuredContent: payload } as any;
        } catch {
          return {
            isError: true,
            content: [{ type: "text", text: err || "invalid JSON output" }],
          } as any;
        }
      } catch (e: any) {
        return { isError: true, content: [{ type: "text", text: String(e?.message || e) }] } as any;
      } finally {
        try {
          if (done) done();
        } catch {}
      }
    });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep process alive while using stdio transport; caller can terminate the process
  await new Promise<void>(() => {});
}

function getErrorTypeFromExitCode(code: number) {
  switch (code) {
    case 1:
      return "InvalidInput";
    case 65:
      return "TransformError";
    case 66:
      return "NotFound";
    case 69:
      return "SpawnError";
    case 78:
      return "ConfigError";
    case 124:
      return "Timeout";
    default:
      return "Error";
  }
}

export function mapExit(code: number) {
  return {
    type: "error",
    structuredContent: undefined,
    error: {
      type: getErrorTypeFromExitCode(code),
      message: `jio exited with code ${code}`,
    },
  } as any;
}
