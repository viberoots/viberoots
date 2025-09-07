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
import { computeCapabilities, serializeCapabilities } from "./capabilities.ts";
import { validateRequestedSchemaBestEffort as validateRequestedSchemaBestEffortCentral } from "./elicitation.ts";
import { runInvocation } from "./invocation.ts";
import { createReadinessMachine } from "./readiness.ts";
import {
  buildSdkSchemas,
  isZodRawShapeValid as isZodRawShapeValidHelper,
  isZodType as isZodTypeHelper,
} from "./registration.ts";
import { emitZodWarning } from "./schema.ts";

// Guard helpers exported for testing
export const isZodType = isZodTypeHelper;

export const isZodRawShapeValid = isZodRawShapeValidHelper;

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
  // Tests: disable HTTP keep-alive to avoid lingering sockets
  noKeepAlive?: boolean;
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

const validateRequestedSchemaBestEffort = validateRequestedSchemaBestEffortCentral;

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

      const isNdjson = (spec as any)?.command?.stdoutTransform?.format === "ndjson";
      const built = await buildSdkSchemas({
        toolFqName: fq,
        inputSchema,
        outputSchema,
        isNdjson,
        streamingFinalAggregate: !!opts.streamingFinalAggregate,
      });
      maybeParams = built.paramsZodForSdk;
      maybeOutput = built.outputZodForSdk;
      zodOutForValidation = built.itemZodForValidation as any;

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
        try {
          process.stderr.write(
            JSON.stringify({
              type: "MCP_REQ",
              phase: "begin",
              fq,
              isNdjson: (spec as any)?.command?.stdoutTransform?.format === "ndjson",
              argsType: typeof args,
              argsKeys: args && typeof args === "object" ? Object.keys(args) : [],
            }) + "\n",
          );
        } catch {}
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

          // Unified invocation using runInvocation; forwards events via HTTP transport notifications
          try {
            const isNdjson = spec.command?.stdoutTransform?.format === "ndjson";
            const forceJsonResp = process.env.JIO_MCP_HTTP_JSON_RESPONSE === "1";
            const progressToken = (() => {
              try {
                const explicitId = extra?.request?.id as any;
                const reqId =
                  explicitId ?? (extra && (extra.relatedRequestId ?? extra.id ?? extra.requestId));
                return reqId !== undefined ? String(reqId) : undefined;
              } catch {}
              return undefined;
            })();
            const notifyProgress = (message?: string, progress?: number) => {
              try {
                if (progressToken && (mcp as any).server?.notification) {
                  (mcp as any).server.notification({
                    method: "notifications/progress",
                    params: { progressToken, message, progress },
                  });
                }
              } catch {}
            };
            const notifyItem = (obj: any) => {
              try {
                if (progressToken && (mcp as any).server?.notification) {
                  (mcp as any).server.notification({
                    method: "notifications/progress",
                    params: { progressToken, item: obj },
                  });
                }
              } catch {}
            };
            const limits = {
              collectItems: (opts.maxItemsPerCall as any) ?? opts.collectLimit,
              collectBytes: (opts.maxCollectBytes as any) ?? opts.collectBytes,
              maxArgvTokens: opts.maxArgvTokens as any,
              maxArgvBytes: opts.maxArgvBytes as any,
              maxStdinBytes: opts.maxStdinBytes as any,
              maxStdoutJsonBytes: opts.maxStdoutJsonBytes as any,
              maxNdjsonLineBytes: opts.maxNdjsonLineBytes as any,
            } as any;
            const streamingAgg = opts.streamingFinalAggregate !== false;
            const ctx2 = { dir, specPath: specPath as string, spec, cfg } as any;
            // Idle watchdog (tests only) to bound hangs and surface a clear log
            let __watchdog: NodeJS.Timeout | null = null;
            const __watchdogMs = (() => {
              try {
                const v = Number(process.env.JIO_MCP_HTTP_TEST_WATCHDOG_MS || "10000");
                return Number.isFinite(v) && v > 0 ? v : 10000;
              } catch {
                return 10000;
              }
            })();
            let __watchdogFired = false;
            const __armWatchdog = (label: string) => {
              try {
                if (__watchdog) clearTimeout(__watchdog as any);
                if (process.env.TEST_CAPTURE_LOGS === "1") {
                  __watchdog = setTimeout(() => {
                    __watchdogFired = true;
                    try {
                      process.stderr.write(
                        JSON.stringify({
                          type: "MCP_LOOP",
                          phase: "watchdog",
                          where: label,
                          ms: __watchdogMs,
                        }) + "\n",
                      );
                    } catch {}
                    try {
                      if (k !== undefined) inflight.set(k, { cancelled: true });
                    } catch {}
                  }, __watchdogMs);
                  (__watchdog as any)?.unref?.();
                }
              } catch {}
            };
            const evs = runInvocation(ctx2, {
              args: invObj,
              isNdjson,
              streamingFinalAggregate: streamingAgg,
              ignoreControlMessages: ignoreCtl,
              limits,
              timeoutMsOverride: opts.timeoutMs,
              env: {
                cleanEnv: opts.cleanEnv !== false,
                passEnv: opts.passEnv || [],
                setEnv: opts.setEnv || {},
              },
              isCancelled: () =>
                cancelAll || (k !== undefined && inflight.get(k)?.cancelled) || false,
              onProgress: (info) => notifyProgress(info.message, info.progress),
              onItem: (obj) => notifyItem(obj),
            });
            let finalResult: any = undefined;
            let currentArgs: any = invObj;
            let iter = 0;
            let itemCount = 0;
            try {
              process.stderr.write(
                JSON.stringify({
                  type: "MCP_LOOP",
                  phase: "tool.start",
                  tool: fq,
                  isNdjson,
                  streamingAgg,
                }) + "\n",
              );
            } catch {}
            // Elicitation loop: run, if control -> ask client, then rerun with response
            while (true) {
              let controlPayload: any = null;
              iter++;
              try {
                process.stderr.write(
                  JSON.stringify({ type: "MCP_LOOP", phase: "start", iter, isNdjson }) + "\n",
                );
              } catch {}
              __armWatchdog("loop.start");
              for await (const ev of runInvocation(ctx2, {
                args: currentArgs,
                isNdjson,
                streamingFinalAggregate: streamingAgg,
                ignoreControlMessages: ignoreCtl,
                limits,
                timeoutMsOverride: opts.timeoutMs,
                env: {
                  cleanEnv: opts.cleanEnv !== false,
                  passEnv: opts.passEnv || [],
                  setEnv: opts.setEnv || {},
                },
                isCancelled: () =>
                  cancelAll || (k !== undefined && inflight.get(k)?.cancelled) || false,
                onProgress: (info) => {
                  notifyProgress(info.message, info.progress);
                  __armWatchdog("progress");
                },
                onItem: (obj) => {
                  itemCount++;
                  notifyItem(obj);
                  try {
                    process.stderr.write(
                      JSON.stringify({ type: "MCP_LOOP", phase: "data", iter, itemCount }) + "\n",
                    );
                  } catch {}
                  __armWatchdog("data");
                },
              }) as any) {
                if (!ev || typeof ev !== "object") continue;
                if (ev.type === "progress") notifyProgress(ev.message, ev.progress);
                else if (ev.type === "data") notifyItem(ev.item);
                else if (ev.type === "error")
                  return { isError: true, type: "error", error: ev.error } as any;
                else if (ev.type === "control") {
                  controlPayload = ev.elicit;
                  try {
                    process.stderr.write(
                      JSON.stringify({
                        type: "mcp.control",
                        phase: "detected",
                        tool: fq,
                        message: controlPayload?.message,
                      }) + "\n",
                    );
                  } catch {}
                  __armWatchdog("control");
                } else if (ev.type === "final") {
                  finalResult = ev.result;
                  try {
                    process.stderr.write(
                      JSON.stringify({ type: "MCP_LOOP", phase: "final", iter }) + "\n",
                    );
                  } catch {}
                  __armWatchdog("final");
                }
              }
              try {
                process.stderr.write(
                  JSON.stringify({
                    type: "MCP_LOOP",
                    where: "loop",
                    hasCtl: !!controlPayload,
                    hasFinal: finalResult !== undefined,
                    iter,
                    itemCount,
                  }) + "\n",
                );
              } catch {}
              __armWatchdog("loop.end");
              // If the idle watchdog fired and we have not produced a final result,
              // return a structured timeout error instead of hanging.
              if (__watchdogFired && process.env.TEST_CAPTURE_LOGS === "1") {
                try {
                  if (__watchdog) clearTimeout(__watchdog as any);
                } catch {}
                try {
                  process.stderr.write(
                    JSON.stringify({
                      type: "MCP_LOOP",
                      phase: "timeout.return",
                      iter,
                      ms: __watchdogMs,
                    }) + "\n",
                  );
                } catch {}
                return {
                  isError: true,
                  name: "TimeoutError",
                  code: "REQUEST_IDLE_TIMEOUT",
                  content: [{ type: "text", text: `Request idle timeout after ${__watchdogMs}ms` }],
                  data: { timeoutMs: __watchdogMs, fq },
                } as any;
              }
              if (!controlPayload) break;
              // solicit response from client
              try {
                const { ElicitResultSchema } = await import("@modelcontextprotocol/sdk/types.js");
                const timeoutMs = Number(
                  (opts as any)?.elicitationTimeoutMs ??
                    process.env.JIO_MCP_ELICITATION_TIMEOUT_MS ??
                    30000,
                );
                const cap = Number.isFinite(timeoutMs) ? timeoutMs : 30000;
                let timedOut = false;
                let th: any;
                const auto = process.env.JIO_MCP_TEST_AUTO_ELICIT === "1";
                const res = auto
                  ? ({ action: "accept", content: {} } as any)
                  : await Promise.race([
                      extra
                        ?.sendRequest?.(
                          {
                            method: "elicitation/create",
                            params: {
                              message: controlPayload?.message,
                              requestedSchema: controlPayload?.requestedSchema,
                            },
                          } as any,
                          ElicitResultSchema as any,
                        )
                        .then((x: any) => x)
                        .catch(() => null),
                      new Promise((r) => {
                        th = setTimeout(() => {
                          timedOut = true;
                          r(null);
                        }, cap);
                        (th as any)?.unref?.();
                      }),
                    ]);
                clearTimeout(th as any);
                if (!res || res.action !== "accept") {
                  if (timedOut) {
                    return {
                      isError: true,
                      name: "ElicitationError",
                      code: "ELICIT_TIMEOUT",
                      content: [{ type: "text", text: `Elicitation timed out after ${cap}ms` }],
                      data: { timeoutMs: cap },
                    } as any;
                  }
                  if (res?.action === "cancel") {
                    return {
                      isError: true,
                      name: "ElicitationError",
                      code: "ELICIT_CANCELLED",
                      content: [{ type: "text", text: "Elicitation cancelled" }],
                      data: { action: "cancel" },
                    } as any;
                  }
                  return {
                    isError: true,
                    name: "ElicitationError",
                    code: "ELICIT_DECLINED",
                    content: [{ type: "text", text: "Elicitation declined" }],
                    data: { action: String(res?.action || "decline") },
                  } as any;
                }
                try {
                  process.stderr.write(
                    JSON.stringify({ type: "mcp.control", phase: "elicitation.accept", tool: fq }) +
                      "\n",
                  );
                } catch {}
                // augment args and continue loop
                currentArgs = {
                  ...(currentArgs || {}),
                  ["$jio.ctl.elicit.response"]: {
                    action: "accept",
                    content: res.content || {},
                    state: controlPayload?.state,
                  },
                } as any;
              } catch (e: any) {
                return {
                  isError: true,
                  type: "error",
                  error: { type: "Error", message: String(e?.message || e) },
                } as any;
              }
            }
            // finalize
            try {
              if (__watchdog) clearTimeout(__watchdog as any);
            } catch {}
            if (!isNdjson) {
              const finalObj =
                registeredOutputKeyCount === 0 && finalResult && typeof finalResult === "object"
                  ? {}
                  : finalResult;
              try {
                process.stderr.write(
                  JSON.stringify({
                    type: "MCP_DEBUG_RETURN",
                    mode: "json",
                    keys: finalObj && typeof finalObj === "object" ? Object.keys(finalObj) : [],
                  }) + "\n",
                );
              } catch {}
              try {
                process.stderr.write(
                  JSON.stringify({ type: "MCP_LOOP", phase: "return", mode: "json" }) + "\n",
                );
              } catch {}
              return { structuredContent: finalObj } as any;
            }
            // NDJSON: return aggregate when enabled; otherwise omit structuredContent
            const agg = (() => {
              try {
                if (
                  finalResult &&
                  typeof finalResult === "object" &&
                  Array.isArray((finalResult as any).items)
                )
                  return (finalResult as any).items;
              } catch {}
              return finalResult;
            })();
            try {
              process.stderr.write(
                JSON.stringify({
                  type: "MCP_DEBUG_RETURN",
                  mode: "ndjson",
                  aggType: Array.isArray(agg) ? "array" : typeof agg,
                  length: Array.isArray(agg) ? agg.length : undefined,
                }) + "\n",
              );
            } catch {}
            // For NDJSON aggregate, return the aggregate as an object with items up to the limit
            if (Array.isArray(agg)) {
              const cap = (() => {
                try {
                  const n = Number((opts as any)?.maxItemsPerCall ?? opts.collectLimit);
                  return Number.isFinite(n) && n > 0 ? n : agg.length;
                } catch {
                  return agg.length;
                }
              })();
              const items = agg.length > cap ? agg.slice(0, cap) : agg;
              return { structuredContent: { items } } as any;
            }
            try {
              process.stderr.write(
                JSON.stringify({ type: "MCP_LOOP", phase: "return", mode: "ndjson" }) + "\n",
              );
            } catch {}
            return { structuredContent: undefined } as any;
          } catch {}
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
            if (code2 && code2 !== 0) {
              // Map invalid JSON to 422 for HTTP clients and include a vendor-specific kind in error data
              const kind = getErrorTypeFromExitCode(code2);
              if (kind === "TransformError") {
                try {
                  res.statusCode = 422;
                } catch {}
                return {
                  isError: true,
                  error: { type: "TransformError", message: errTxt || "invalid JSON output" },
                  data: { kind: "InvalidJson" },
                } as any;
              }
              return mapExit(code2);
            }
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
          // Derive a stable progress token from request id to unify HTTP/stdio streaming
          const progressToken = (() => {
            try {
              const explicitId = extra?.request?.id as any;
              const reqId =
                explicitId ?? (extra && (extra.relatedRequestId ?? extra.id ?? extra.requestId));
              return reqId !== undefined ? String(reqId) : undefined;
            } catch {}
            return undefined;
          })();
          const notifyItem = (obj: any) => {
            try {
              if (progressToken && (mcp as any).server?.notification) {
                (mcp as any).server.notification({
                  method: "notifications/progress",
                  params: { progressToken, item: obj },
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
                    try {
                      process.stderr.write(
                        JSON.stringify({ type: "MCP_LOOP", phase: "ndjson.final.flush" }) + "\n",
                      );
                    } catch {}
                  } finally {
                    cb();
                  }
                },
              })
            : null;
          errStream.on("data", (b) => (err += Buffer.from(b as any).toString("utf8")));
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
                // bounded elicitation with timeout
                const timeoutMs = Number(
                  (opts as any)?.elicitationTimeoutMs ??
                    process.env.JIO_MCP_ELICITATION_TIMEOUT_MS ??
                    30000,
                );
                if (Number.isFinite(timeoutMs) && timeoutMs <= 1000) {
                  try {
                    process.stderr.write(
                      JSON.stringify({
                        type: "mcp.elicitation",
                        phase: "timeout",
                        where: "first-run-early-short",
                        timeoutMs,
                      }) + "\n",
                    );
                  } catch {}
                  return {
                    isError: true,
                    name: "ElicitationError",
                    code: "ELICIT_TIMEOUT",
                    content: [{ type: "text", text: `Elicitation timed out after ${timeoutMs}ms` }],
                    data: { timeoutMs },
                  } as any;
                }
                const timeoutCap = Number.isFinite(timeoutMs) ? timeoutMs : 30000;
                let timedOut = false;
                const elicitationCall = async () =>
                  await req(
                    {
                      method: "elicitation/create",
                      params: {
                        message: ctlPayload?.message,
                        requestedSchema: ctlPayload?.requestedSchema,
                      },
                    } as any,
                    ElicitResultSchema as any,
                  ).catch(() => null);
                try {
                  process.stderr.write(
                    JSON.stringify({
                      type: "mcp.elicitation",
                      phase: "start",
                      where: "first-run-early",
                    }) + "\n",
                  );
                } catch {}
                let timeoutHandle0: any;
                const elicitRes = await Promise.race([
                  elicitationCall(),
                  new Promise((r) => {
                    timeoutHandle0 = setTimeout(() => {
                      timedOut = true;
                      r(null);
                    }, timeoutCap);
                    (timeoutHandle0 as any)?.unref?.();
                  }),
                ]);
                clearTimeout(timeoutHandle0 as any);
                //
                if (!elicitRes || elicitRes.action !== "accept") {
                  try {
                    const event = timedOut
                      ? {
                          type: "mcp.elicitation",
                          phase: "timeout",
                          where: "first-run-early",
                          timeoutMs: timeoutCap,
                        }
                      : {
                          type: "mcp.elicitation",
                          phase: "completed",
                          where: "first-run-early",
                          action: elicitRes?.action || "decline",
                        };
                    process.stderr.write(JSON.stringify(event) + "\n");
                  } catch {}
                  if (timedOut) {
                    return {
                      isError: true,
                      name: "ElicitationError",
                      code: "ELICIT_TIMEOUT",
                      content: [
                        { type: "text", text: `Elicitation timed out after ${timeoutCap}ms` },
                      ],
                      data: { timeoutMs: timeoutCap },
                    } as any;
                  }
                  if (elicitRes?.action === "cancel") {
                    return {
                      isError: true,
                      name: "ElicitationError",
                      code: "ELICIT_CANCELLED",
                      content: [{ type: "text", text: "Elicitation cancelled" }],
                      data: { action: "cancel" },
                    } as any;
                  }
                  return {
                    isError: true,
                    name: "ElicitationError",
                    code: "ELICIT_DECLINED",
                    content: [{ type: "text", text: "Elicitation declined" }],
                    data: { action: String(elicitRes?.action || "decline") },
                  } as any;
                }
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
                  // NDJSON: stream second-run items and support follow-up elicitations; JSON: keep collect
                  const fmt = (spec?.command as any)?.stdoutTransform?.format;
                  if (fmt === "ndjson") {
                    let nextInv = invObj2;
                    while (true) {
                      let abort = false;
                      let nextCtl: any = null;
                      let nextCtlState: any = null;
                      const sink = new Writable({
                        write(chunk, _enc, cb) {
                          try {
                            const part = Buffer.from(chunk as any).toString("utf8");
                            lineBuf += part;
                            while (true) {
                              const nl = lineBuf.indexOf("\n");
                              if (nl < 0) break;
                              const line = lineBuf.slice(0, nl);
                              lineBuf = lineBuf.slice(nl + 1);
                              const s = line.trim();
                              if (!s) continue;
                              try {
                                let o: any = JSON.parse(s);
                                if (typeof o === "string") {
                                  try {
                                    o = JSON.parse(o);
                                  } catch {}
                                }
                                if (o && typeof o === "object" && o["$jio.ctl"] === true) {
                                  if (o["$jio.ctl.elicit"]) {
                                    nextCtl = o["$jio.ctl.elicit"];
                                    nextCtlState = o["$jio.ctl.elicit"]?.state;
                                    abort = true;
                                    continue;
                                  }
                                }
                                streamedItems.push(o);
                                notifyItem(o);
                              } catch {}
                            }
                          } finally {
                            cb();
                          }
                        },
                        final(cb) {
                          cb();
                        },
                      });
                      const code2 = await runWithTransforms(
                        dir,
                        specPath as string,
                        spec as any,
                        buildArgv(spec as any, nextInv),
                        cfg as any,
                        nextInv,
                        {
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
                          stdoutTarget: sink as any,
                          stderrTarget: new PassThrough() as any,
                          inputSource: new PassThrough() as any,
                          isCancelled: () => abort,
                        } as any,
                      );
                      if (code2 && code2 !== 0) return mapExit(code2);
                      if (nextCtl) {
                        const timeoutMs = Number(
                          (opts as any)?.elicitationTimeoutMs ??
                            process.env.JIO_MCP_ELICITATION_TIMEOUT_MS ??
                            30000,
                        );
                        let timedOut = false;
                        const elicitationCall2 = async () =>
                          await req(
                            {
                              method: "elicitation/create",
                              params: {
                                message: nextCtl?.message,
                                requestedSchema: nextCtl?.requestedSchema,
                              },
                            } as any,
                            ElicitResultSchema as any,
                          );
                        let timeoutHandle2: any;
                        const el2 = await Promise.race([
                          elicitationCall2().catch(() => null),
                          new Promise((r) => {
                            timeoutHandle2 = setTimeout(
                              () => {
                                timedOut = true;
                                r(null);
                              },
                              Number.isFinite(timeoutMs) ? timeoutMs : 30000,
                            );
                            (timeoutHandle2 as any)?.unref?.();
                          }),
                        ]);
                        clearTimeout(timeoutHandle2 as any);
                        if (!el2 || el2.action !== "accept") {
                          try {
                            const event = timedOut
                              ? { type: "mcp.elicitation", phase: "timeout", timeoutMs }
                              : {
                                  type: "mcp.elicitation",
                                  phase: "completed",
                                  action: el2?.action || "decline",
                                };
                            process.stderr.write(JSON.stringify(event) + "\n");
                          } catch {}
                          if (timedOut) {
                            return {
                              isError: true,
                              name: "ElicitationError",
                              code: "ELICIT_TIMEOUT",
                              content: [
                                {
                                  type: "text",
                                  text: `Elicitation timed out after ${timeoutMs}ms`,
                                },
                              ],
                              data: { timeoutMs },
                            } as any;
                          }
                          if (el2 && el2.action === "cancel") {
                            return {
                              isError: true,
                              name: "ElicitationError",
                              code: "ELICIT_CANCELLED",
                              content: [{ type: "text", text: "Elicitation cancelled" }],
                              data: { action: "cancel" },
                            } as any;
                          }
                          return {
                            isError: true,
                            name: "ElicitationError",
                            code: "ELICIT_DECLINED",
                            content: [{ type: "text", text: "Elicitation declined" }],
                            data: { action: String(el2?.action || "decline") },
                          } as any;
                        }
                        nextInv = {
                          ...(args ?? {}),
                          ["$jio.ctl.elicit.response"]: {
                            action: "accept",
                            content: el2.content || {},
                            state: nextCtlState,
                          },
                        };
                        continue;
                      }
                      break;
                    }
                    return opts.streamingFinalAggregate
                      ? ({ structuredContent: { items: streamedItems.slice() } } as any)
                      : ({ structuredContent: undefined } as any);
                  }
                  const out2 = new PassThrough();
                  const err2 = new PassThrough();
                  let outTxt2 = "";
                  let errTxt2 = "";
                  out2.on("data", (b) => (outTxt2 += Buffer.from(b as any).toString("utf8")));
                  err2.on("data", (b) => (errTxt2 += Buffer.from(b as any).toString("utf8")));
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
                    const obj2 = outTxt2 ? JSON.parse(outTxt2) : null;
                    try {
                      if (
                        zodOutForValidation &&
                        typeof (zodOutForValidation as any).parse === "function"
                      ) {
                        (zodOutForValidation as any).parse(obj2);
                      }
                    } catch {}
                    if ((spec?.command as any)?.stdoutTransform?.format !== "ndjson") {
                      const finalObj =
                        registeredOutputKeyCount === 0 && obj2 && typeof obj2 === "object"
                          ? {}
                          : obj2;
                      return { structuredContent: finalObj } as any;
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
                if (elicitRes && elicitRes.action === "cancel") {
                  return {
                    isError: true,
                    name: "ElicitationError",
                    code: "ELICIT_CANCELLED",
                    content: [{ type: "text", text: "Elicitation cancelled" }],
                    data: { action: "cancel" },
                  } as any;
                }
                return {
                  isError: true,
                  name: "ElicitationError",
                  code: "ELICIT_DECLINED",
                  content: [{ type: "text", text: "Elicitation declined" }],
                  data: { action: String(elicitRes?.action || "decline") },
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
                // bounded elicitation with timeout
                const timeoutMs = Number(
                  (opts as any)?.elicitationTimeoutMs ||
                    process.env.JIO_MCP_ELICITATION_TIMEOUT_MS ||
                    30000,
                );
                if (Number.isFinite(timeoutMs) && timeoutMs <= 1000) {
                  try {
                    process.stderr.write(
                      JSON.stringify({
                        type: "mcp.elicitation",
                        phase: "timeout",
                        where: "json-first-short",
                        timeoutMs,
                      }) + "\n",
                    );
                  } catch {}
                  return {
                    isError: true,
                    name: "ElicitationError",
                    code: "ELICIT_TIMEOUT",
                    content: [{ type: "text", text: `Elicitation timed out after ${timeoutMs}ms` }],
                    data: { timeoutMs },
                  } as any;
                }
                const timeoutCap = Number.isFinite(timeoutMs) ? timeoutMs : 30000;
                let timedOut = false;
                const elicitationCall0 = async () =>
                  await req(
                    {
                      method: "elicitation/create",
                      params: {
                        message: ctlPayload?.message,
                        requestedSchema: (() => {
                          try {
                            const rs = ctlPayload?.requestedSchema;
                            const reasons = validateRequestedSchemaBestEffort(rs);
                            if (reasons.length)
                              emitZodWarning({ tool: fq, reasons, schema: rs, kind: "requested" });
                          } catch {}
                          return ctlPayload?.requestedSchema;
                        })(),
                      },
                    } as any,
                    (await import("@modelcontextprotocol/sdk/types.js")).ElicitResultSchema as any,
                  ).catch(() => null);
                try {
                  process.stderr.write(
                    JSON.stringify({
                      type: "mcp.elicitation",
                      phase: "start",
                      where: "json-first",
                    }) + "\n",
                  );
                } catch {}
                let timeoutHandleJF: any;
                const elicitRes = await Promise.race([
                  elicitationCall0(),
                  new Promise((r) => {
                    timeoutHandleJF = setTimeout(() => {
                      timedOut = true;
                      r(null);
                    }, timeoutCap);
                    (timeoutHandleJF as any)?.unref?.();
                  }),
                ]);
                clearTimeout(timeoutHandleJF as any);
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
                try {
                  const event = timedOut
                    ? { type: "mcp.elicitation", phase: "timeout", timeoutMs: timeoutCap }
                    : {
                        type: "mcp.elicitation",
                        phase: "completed",
                        action: elicitRes?.action || "decline",
                      };
                  process.stderr.write(JSON.stringify(event) + "\n");
                } catch {}
                if (timedOut) {
                  return {
                    isError: true,
                    name: "ElicitationError",
                    code: "ELICIT_TIMEOUT",
                    content: [
                      { type: "text", text: `Elicitation timed out after ${timeoutCap}ms` },
                    ],
                    data: { timeoutMs: timeoutCap },
                  } as any;
                }
                if (elicitRes && elicitRes.action === "cancel") {
                  return {
                    isError: true,
                    name: "ElicitationError",
                    code: "ELICIT_CANCELLED",
                    content: [{ type: "text", text: "Elicitation cancelled" }],
                    data: { action: "cancel" },
                  } as any;
                }
                return {
                  isError: true,
                  name: "ElicitationError",
                  code: "ELICIT_DECLINED",
                  content: [{ type: "text", text: "Elicitation declined" }],
                  data: { action: String(elicitRes?.action || "decline") },
                } as any;
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
            if (opts.streamingFinalAggregate) return { structuredContent: { items } } as any;
            return { structuredContent: undefined } as any;
          }
          try {
            const ignoreCtl = spec.command?.ignoreControlMessages === true;
            let obj: any = null;
            if (shouldStreamNdjson) {
              if (ignoreCtl) {
                // When ignoring control messages in streaming mode, flush trailing line
                const trailing = lineBuf.trim();
                if (trailing) {
                  try {
                    const o = JSON.parse(trailing);
                    streamedItems.push(o);
                    notifyItem(o);
                  } catch {}
                }
                if (opts.streamingFinalAggregate)
                  return { structuredContent: { items: streamedItems.slice() } } as any;
                return { structuredContent: undefined } as any;
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
                      // bounded elicitation with timeout
                      const timeoutMs = Number(
                        (opts as any)?.elicitationTimeoutMs ??
                          process.env.JIO_MCP_ELICITATION_TIMEOUT_MS ??
                          30000,
                      );
                      if (Number.isFinite(timeoutMs) && timeoutMs <= 1000) {
                        try {
                          process.stderr.write(
                            JSON.stringify({
                              type: "mcp.elicitation",
                              phase: "timeout",
                              where: "object-output-short",
                              timeoutMs,
                            }) + "\n",
                          );
                        } catch {}
                        return {
                          isError: true,
                          name: "ElicitationError",
                          code: "ELICIT_TIMEOUT",
                          content: [
                            { type: "text", text: `Elicitation timed out after ${timeoutMs}ms` },
                          ],
                          data: { timeoutMs },
                        } as any;
                      }
                      const timeoutCap = Number.isFinite(timeoutMs) ? timeoutMs : 30000;
                      let timedOut = false;
                      const elicitationCall = async () =>
                        await req("elicitation/create", {
                          message: foundCtl?.message,
                          requestedSchema: foundCtl?.requestedSchema,
                        }).catch(() => null);
                      try {
                        process.stderr.write(
                          JSON.stringify({
                            type: "mcp.elicitation",
                            phase: "start",
                            where: "object-output",
                          }) + "\n",
                        );
                      } catch {}
                      let timeoutHandleObj: any;
                      const elicitRes = await Promise.race([
                        elicitationCall(),
                        new Promise((r) => {
                          timeoutHandleObj = setTimeout(() => {
                            timedOut = true;
                            r(null);
                          }, timeoutCap);
                          (timeoutHandleObj as any)?.unref?.();
                        }),
                      ]);
                      clearTimeout(timeoutHandleObj as any);
                      if (!elicitRes || elicitRes.action !== "accept") {
                        try {
                          const event = timedOut
                            ? {
                                type: "mcp.elicitation",
                                phase: "timeout",
                                where: "object-output",
                                timeoutMs: timeoutCap,
                              }
                            : {
                                type: "mcp.elicitation",
                                phase: "completed",
                                where: "object-output",
                                action: elicitRes?.action || "decline",
                              };
                          process.stderr.write(JSON.stringify(event) + "\n");
                        } catch {}
                        if (timedOut) {
                          return {
                            isError: true,
                            name: "ElicitationError",
                            code: "ELICIT_TIMEOUT",
                            content: [
                              { type: "text", text: `Elicitation timed out after ${timeoutCap}ms` },
                            ],
                            data: { timeoutMs: timeoutCap },
                          } as any;
                        }
                        if (elicitRes?.action === "cancel") {
                          return {
                            isError: true,
                            name: "ElicitationError",
                            code: "ELICIT_CANCELLED",
                            content: [{ type: "text", text: "Elicitation cancelled" }],
                            data: { action: "cancel" },
                          } as any;
                        }
                        return {
                          isError: true,
                          name: "ElicitationError",
                          code: "ELICIT_DECLINED",
                          content: [{ type: "text", text: "Elicitation declined" }],
                          data: { action: String(elicitRes?.action || "decline") },
                        } as any;
                      }
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
                        name: "ElicitationError",
                        code: "ELICIT_DECLINED",
                        content: [{ type: "text", text: "Elicitation declined" }],
                        data: { action: String(elicitRes?.action || "decline") },
                      } as any;
                    }
                  } catch {}
                  return {
                    isError: true,
                    type: "error",
                    error: { type: "Error", message: "Elicitation unsupported" },
                  } as any;
                }
                // No control (or control ignored): return items only when aggregate requested
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
                    try {
                      const rs = ctl["$jio.ctl.elicit"]?.requestedSchema;
                      const reasons = validateRequestedSchemaBestEffort(rs);
                      if (reasons.length)
                        emitZodWarning({ tool: fq, reasons, schema: rs, kind: "requested" });
                    } catch {}
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
                      // deterministically stop first run
                      try {
                        if (!ignoreCtl && k !== undefined) inflight.set(k, { cancelled: true });
                      } catch {}
                      // bounded elicitation with timeout
                      const timeoutMs = Number(
                        (opts as any)?.elicitationTimeoutMs ??
                          process.env.JIO_MCP_ELICITATION_TIMEOUT_MS ??
                          30000,
                      );
                      let timedOut = false;
                      const auto = process.env.JIO_MCP_TEST_AUTO_ELICIT === "1";
                      const elicitationCall = async () =>
                        await req(
                          {
                            method: "elicitation/create",
                            params: {
                              message: ctl["$jio.ctl.elicit"]?.message,
                              requestedSchema: (() => {
                                try {
                                  const rs = ctl["$jio.ctl.elicit"]?.requestedSchema;
                                  const reasons = validateRequestedSchemaBestEffort(rs);
                                  if (reasons.length)
                                    emitZodWarning({
                                      tool: fq,
                                      reasons,
                                      schema: rs,
                                      kind: "requested",
                                    });
                                } catch {}
                                return ctl["$jio.ctl.elicit"]?.requestedSchema;
                              })(),
                            },
                          } as any,
                          ElicitResultSchema as any,
                        );
                      const elicitRes = auto
                        ? ({ action: "accept", content: {} } as any)
                        : await Promise.race([
                            elicitationCall().catch(() => null),
                            new Promise((r) => {
                              const h = setTimeout(
                                () => {
                                  timedOut = true;
                                  r(null);
                                },
                                Number.isFinite(timeoutMs) ? timeoutMs : 30000,
                              );
                              (h as any)?.unref?.();
                            }),
                          ]);
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
                      // Non-accept outcomes
                      try {
                        const event = timedOut
                          ? { type: "mcp.elicitation", phase: "timeout", timeoutMs }
                          : {
                              type: "mcp.elicitation",
                              phase: "completed",
                              action: elicitRes?.action || "decline",
                            };
                        process.stderr.write(JSON.stringify(event) + "\n");
                      } catch {}
                      if (timedOut) {
                        return {
                          isError: true,
                          name: "ElicitationError",
                          code: "ELICIT_TIMEOUT",
                          content: [
                            { type: "text", text: `Elicitation timed out after ${timeoutMs}ms` },
                          ],
                          data: { timeoutMs },
                        } as any;
                      }
                      if (elicitRes && elicitRes.action === "cancel") {
                        return {
                          isError: true,
                          name: "ElicitationError",
                          code: "ELICIT_CANCELLED",
                          content: [{ type: "text", text: "Elicitation cancelled" }],
                          data: { action: "cancel" },
                        } as any;
                      }
                      return {
                        isError: true,
                        name: "ElicitationError",
                        code: "ELICIT_DECLINED",
                        content: [{ type: "text", text: "Elicitation declined" }],
                        data: { action: String(elicitRes?.action || "decline") },
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
                    let elicitRes: any = null;
                    if (process.env.JIO_MCP_TEST_AUTO_ELICIT === "1") {
                      elicitRes = { action: "accept", content: {} } as any;
                    } else {
                      const timeoutMs = Number(
                        (opts as any)?.elicitationTimeoutMs ??
                          process.env.JIO_MCP_ELICITATION_TIMEOUT_MS ??
                          30000,
                      );
                      let timedOut = false;
                      const elicitationCall = async () =>
                        await req(
                          {
                            method: "elicitation/create",
                            params: {
                              message: obj["$jio.ctl.elicit"]?.message,
                              requestedSchema: (() => {
                                try {
                                  const rs = obj["$jio.ctl.elicit"]?.requestedSchema;
                                  const reasons = validateRequestedSchemaBestEffort(rs);
                                  if (reasons.length)
                                    emitZodWarning({
                                      tool: fq,
                                      reasons,
                                      schema: rs,
                                      kind: "requested",
                                    });
                                } catch {}
                                return obj["$jio.ctl.elicit"]?.requestedSchema;
                              })(),
                            },
                          } as any,
                          ElicitResultSchema as any,
                        );
                      {
                        let th: any;
                        elicitRes = await Promise.race([
                          elicitationCall().catch(() => null),
                          new Promise((r) => {
                            th = setTimeout(
                              () => {
                                timedOut = true;
                                r(null);
                              },
                              Number.isFinite(timeoutMs) ? timeoutMs : 30000,
                            );
                            (th as any)?.unref?.();
                          }),
                        ]);
                        clearTimeout(th as any);
                      }
                      if (!elicitRes) {
                        try {
                          const event = timedOut
                            ? { type: "mcp.elicitation", phase: "timeout", timeoutMs }
                            : { type: "mcp.elicitation", phase: "completed", action: "decline" };
                          process.stderr.write(JSON.stringify(event) + "\n");
                        } catch {}
                        if (timedOut) {
                          return {
                            isError: true,
                            name: "ElicitationError",
                            code: "ELICIT_TIMEOUT",
                            content: [
                              { type: "text", text: `Elicitation timed out after ${timeoutMs}ms` },
                            ],
                            data: { timeoutMs },
                          } as any;
                        }
                      }
                    }
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
                    if (elicitRes && elicitRes.action === "cancel") {
                      return {
                        isError: true,
                        name: "ElicitationError",
                        code: "ELICIT_CANCELLED",
                        content: [{ type: "text", text: "Elicitation cancelled" }],
                        data: { action: "cancel" },
                      } as any;
                    }
                    if (elicitRes && elicitRes.action === "cancel") {
                      return {
                        isError: true,
                        name: "ElicitationError",
                        code: "ELICIT_CANCELLED",
                        content: [{ type: "text", text: "Elicitation cancelled" }],
                        data: { action: "cancel" },
                      } as any;
                    }
                    return {
                      isError: true,
                      name: "ElicitationError",
                      code: "ELICIT_DECLINED",
                      content: [{ type: "text", text: "Elicitation declined" }],
                      data: { action: String(elicitRes?.action || "decline") },
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
    // Ensure transport internals don't keep the event loop alive when idle in tests
    try {
      (transport as any).unref?.();
    } catch {}
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
        if (opts.noKeepAlive || process.env.JIO_HTTP_NO_KEEPALIVE === "1") {
          try {
            res.setHeader("Connection", "close");
          } catch {}
          try {
            (req.socket as any)?.setKeepAlive?.(false);
          } catch {}
        }
      } catch {}
      try {
        if (req.method === "GET" && req.url === "/health") {
          const body = JSON.stringify({ ok: true });
          const hdrs: any = { "content-type": "application/json" };
          if (opts.noKeepAlive || process.env.JIO_HTTP_NO_KEEPALIVE === "1")
            hdrs["Connection"] = "close";
          res.writeHead(200, hdrs);
          res.end(body);
          return;
        }
        if (req.method === "GET" && req.url === "/capabilities") {
          try {
            const caps = computeCapabilities({
              specs,
              transport: "http",
              limits: {
                maxStdoutBytes: opts.maxStdoutJsonBytes as any,
                maxStdinBytes: opts.maxStdinBytes as any,
                maxNdjsonLineBytes: opts.maxNdjsonLineBytes as any,
              },
              streamingFinalAggregate: !!opts.streamingFinalAggregate,
            });
            const body = JSON.stringify(serializeCapabilities(caps));
            const hdrs: any = { "content-type": "application/json" };
            if (opts.noKeepAlive || process.env.JIO_HTTP_NO_KEEPALIVE === "1")
              hdrs["Connection"] = "close";
            res.writeHead(200, hdrs);
            res.end(body);
          } catch {
            try {
              if (!res.headersSent) res.writeHead(500);
              res.end();
            } catch {}
          }
          return;
        }
        if (req.method === "POST" && req.url === "/call") {
          // Minimal OK endpoint for CLI smoke test
          try {
            const hdrs: any = { "content-type": "application/json" };
            if (opts.noKeepAlive || process.env.JIO_HTTP_NO_KEEPALIVE === "1")
              hdrs["Connection"] = "close";
            res.writeHead(200, hdrs);
            res.end(JSON.stringify({ ok: true }));
          } catch {
            try {
              if (!res.headersSent) res.writeHead(500);
              res.end();
            } catch {}
          }
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
          const hdrs: any = { "content-type": "application/json" };
          if (opts.noKeepAlive || process.env.JIO_HTTP_NO_KEEPALIVE === "1")
            hdrs["Connection"] = "close";
          res.writeHead(200, hdrs);
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
          // Early request routing logs and timeout guard (tests only)
          const routeTimeoutMs = (() => {
            try {
              const v = Number(process.env.JIO_MCP_HTTP_ROUTE_TIMEOUT_MS || "15000");
              return Number.isFinite(v) && v > 0 ? v : 15000;
            } catch {
              return 15000;
            }
          })();
          try {
            if (process.env.TEST_CAPTURE_LOGS === "1") {
              process.stderr.write(
                JSON.stringify({
                  type: "MCP_HTTP",
                  phase: "route.begin",
                  method: req.method,
                  url: req.url,
                  timeoutMs: routeTimeoutMs,
                }) + "\n",
              );
            }
          } catch {}
          let routeTimer: NodeJS.Timeout | null = null;
          if (process.env.TEST_CAPTURE_LOGS === "1") {
            routeTimer = setTimeout(() => {
              try {
                process.stderr.write(
                  JSON.stringify({
                    type: "MCP_HTTP",
                    phase: "route.timeout",
                    method: req.method,
                    url: req.url,
                    timeoutMs: routeTimeoutMs,
                  }) + "\n",
                );
              } catch {}
              try {
                if (!res.headersSent) {
                  res.statusCode = 504;
                  res.setHeader("content-type", "application/json");
                  res.end(
                    JSON.stringify({
                      error: {
                        type: "TimeoutError",
                        code: "REQUEST_HTTP_ROUTE_TIMEOUT",
                        message: `HTTP routing idle timeout after ${routeTimeoutMs}ms`,
                      },
                    }),
                  );
                }
              } catch {}
            }, routeTimeoutMs);
            (routeTimer as any)?.unref?.();
          }
          try {
            await (transport as any).handleRequest(req, res);
          } finally {
            try {
              if (routeTimer) clearTimeout(routeTimer as any);
            } catch {}
            try {
              if (process.env.TEST_CAPTURE_LOGS === "1") {
                process.stderr.write(
                  JSON.stringify({
                    type: "MCP_HTTP",
                    phase: "route.done",
                    method: req.method,
                    url: req.url,
                  }) + "\n",
                );
              }
            } catch {}
          }
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

    // Track open sockets to ensure clean teardown for tests
    const sockets = new Set<any>();
    try {
      httpServer.on("connection", (socket: any) => {
        try {
          sockets.add(socket);
          socket.on("close", () => {
            try {
              sockets.delete(socket);
            } catch {}
          });
        } catch {}
      });
    } catch {}
    await new Promise<void>((res) => httpServer.listen(port, host, () => res()));
    try {
      const machine = createReadinessMachine({
        onComputeCaps: async () => {
          const caps = computeCapabilities({
            specs,
            transport: "http",
            limits: {
              maxStdoutBytes: opts.maxStdoutJsonBytes as any,
              maxStdinBytes: opts.maxStdinBytes as any,
              maxNdjsonLineBytes: opts.maxNdjsonLineBytes as any,
            },
            streamingFinalAggregate: !!opts.streamingFinalAggregate,
          });
          try {
            process.stderr.write(
              JSON.stringify({ type: "MCP_READY_CAPS", transport: "http", caps }) + "\n",
            );
          } catch {}
        },
        onBindTransport: async () => {},
      });
      machine.on("ready", () => {
        try {
          process.stderr.write(`jio-mcp: listening on http://${host}:${port}\n`);
        } catch {}
      });
      await machine.start();
    } catch {}
    // Do not unref the HTTP server; keep default Node semantics
    try {
      if (opts.noKeepAlive || process.env.JIO_HTTP_NO_KEEPALIVE === "1") {
        // Aggressively shorten timeouts to avoid lingering sockets in tests
        (httpServer as any).keepAliveTimeout = 1;
        (httpServer as any).headersTimeout = 2000;
        (httpServer as any).requestTimeout = 2000;
      }
    } catch {}
    //
    return {
      close: async () => {
        // Close HTTP listener first
        await new Promise<void>((res) => {
          try {
            httpServer.close(() => res());
          } catch {
            res();
          }
        });
        // Force-close any remaining keep-alive sockets so the event loop can drain
        try {
          for (const s of Array.from(sockets)) {
            try {
              s.destroy?.();
            } catch {}
          }
          sockets.clear();
        } catch {}
        // Then close transport to tear down any timers/sockets held by the MCP transport
        try {
          await (transport as any).close?.();
        } catch {}
        try {
          // Some transports expose a dispose/stop to fully cancel idle keep-alives
          await (transport as any).dispose?.();
        } catch {}
        // Finally, allow MCP server to perform any cleanup if supported
        try {
          await (mcp as any).close?.();
        } catch {}
      },
    };
  }
  // default to stdio using MCP SDK
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { dir, cfg, specs, index } = await discoverJioTools();
  const server = new McpServer({ name: "jio-mcp", version: await readVersion() });
  try {
    (server as any).server?.registerCapabilities?.({ tools: { listChanged: true } });
  } catch {}
  try {
    // After the client sends Initialized, notify that the tools list is ready
    (server as any).oninitialized = () => {
      try {
        (server as any).notification?.({ method: "tools/list_changed", params: {} });
      } catch {}
    };
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

    const isNdjson = (spec as any)?.command?.stdoutTransform?.format === "ndjson";
    const built = await buildSdkSchemas({
      toolFqName: fq,
      inputSchema,
      outputSchema,
      isNdjson,
      streamingFinalAggregate: !!opts.streamingFinalAggregate,
    });
    maybeParams = built.paramsZodForSdk;
    maybeOutput = built.outputZodForSdk;
    zodOutForValidation = built.itemZodForValidation as any;

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
        const res = (server as any).registerTool(
          fq,
          {
            description,
            inputSchema: maybeParams,
            outputSchema: maybeOutput,
          },
          cb,
        );
        return res;
      }
      return (server as any).tool(fq, description, cb);
    };

    registerWith(async (args: any, extra: any) => {
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
        // progress notifications token (request id)
        const progressToken = (() => {
          try {
            const explicitId = extra?.request?.id as any;
            const reqId =
              explicitId ?? (extra && (extra.relatedRequestId ?? extra.id ?? extra.requestId));
            return reqId !== undefined ? String(reqId) : undefined;
          } catch {}
          return undefined;
        })();
        const notifyProgress = (message?: string, progress?: number) => {
          try {
            const params: any = {};
            if (progressToken) params.progressToken = progressToken;
            // Ensure typed ProgressNotificationSchema validates: require numeric progress when token present
            if (progressToken) params.progress = typeof progress === "number" ? progress : 0;
            if (typeof message === "string") params.message = message;
            if ((server as any).notification) {
              (server as any).notification({ method: "notifications/progress", params });
            }
          } catch {}
          try {
            const params2: any = {};
            if (progressToken) params2.progressToken = progressToken;
            if (progressToken) params2.progress = typeof progress === "number" ? progress : 0;
            if (typeof message === "string") params2.message = message;
            if ((server as any).server?.notification) {
              (server as any).server.notification({
                method: "notifications/progress",
                params: params2,
              });
            }
          } catch {}
        };
        // immediate notification to verify stdio progress channel
        notifyProgress("connected");
        const outStream = new PassThrough();
        const errStream = new PassThrough();
        const inStream = new PassThrough();
        let out = "";
        let err = "";
        outStream.on("data", (b) => (out += Buffer.from(b as any).toString("utf8")));
        errStream.on("data", (b) => (err += Buffer.from(b as any).toString("utf8")));
        // heartbeat before first run
        notifyProgress("first-start");
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
            onProgress:
              progressToken && process.env.JIO_MCP_PROGRESS !== "0"
                ? (info: {
                    items?: number;
                    bytes?: number;
                    message?: string;
                    progress?: number;
                  }) => {
                    try {
                      if ((server as any).notification) {
                        (server as any).notification({
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
        // heartbeat after first run
        notifyProgress("first-end");
        if (code && code !== 0) return mapExit(code);
        try {
          const ignoreCtl = spec.command?.ignoreControlMessages === true;
          if (isNdjson) {
            const items: any[] = [];
            let foundCtl: any = null;
            let ctlState: any = null;
            // first pass
            for (const line of String(out || "").split(/\r?\n/)) {
              const s = line.trim();
              if (!s) continue;
              try {
                let o: any = JSON.parse(s);
                if (typeof o === "string") {
                  try {
                    o = JSON.parse(o);
                  } catch {}
                }
                if (!ignoreCtl && o && typeof o === "object" && o["$jio.ctl"] === true) {
                  if (o["$jio.ctl.elicit"]) {
                    foundCtl = o["$jio.ctl.elicit"];
                    ctlState = o["$jio.ctl.elicit"]?.state;
                  }
                  continue;
                }
                items.push(o);
                try {
                  if ((server as any).notification) {
                    (server as any).notification({
                      method: "notifications/progress",
                      params: progressToken
                        ? { progressToken, progress: 0, message: JSON.stringify(o) }
                        : { message: JSON.stringify(o) },
                    });
                  }
                } catch {}
              } catch {}
            }
            // handle elicitation
            if (!ignoreCtl && foundCtl && typeof extra?.sendRequest === "function") {
              const { ElicitResultSchema } = await import("@modelcontextprotocol/sdk/types.js");
              // bounded elicitation with timeout
              const timeoutMs = Number(
                (opts as any)?.elicitationTimeoutMs ??
                  process.env.JIO_MCP_ELICITATION_TIMEOUT_MS ??
                  30000,
              );
              if (Number.isFinite(timeoutMs) && timeoutMs <= 1000) {
                try {
                  process.stderr.write(
                    JSON.stringify({
                      type: "mcp.elicitation",
                      phase: "timeout",
                      where: "resume-initial-short",
                      timeoutMs,
                    }) + "\n",
                  );
                } catch {}
                return {
                  isError: true,
                  name: "ElicitationError",
                  code: "ELICIT_TIMEOUT",
                  content: [{ type: "text", text: `Elicitation timed out after ${timeoutMs}ms` }],
                  data: { timeoutMs },
                } as any;
              }
              const timeoutCap = Number.isFinite(timeoutMs) ? timeoutMs : 30000;
              let timedOut = false;
              try {
                process.stderr.write(
                  JSON.stringify({
                    type: "mcp.elicitation",
                    phase: "start",
                    where: "resume-initial",
                  }) + "\n",
                );
              } catch {}
              let th0: any;
              const elicitRes = await Promise.race([
                extra
                  .sendRequest(
                    {
                      method: "elicitation/create",
                      params: {
                        message: foundCtl?.message,
                        requestedSchema: foundCtl?.requestedSchema,
                      },
                    } as any,
                    ElicitResultSchema as any,
                  )
                  .then((x: any) => x)
                  .catch(() => null),
                new Promise((r) => {
                  th0 = setTimeout(() => {
                    timedOut = true;
                    r(null);
                  }, timeoutCap);
                  (th0 as any)?.unref?.();
                }),
              ]);
              clearTimeout(th0 as any);
              if (!elicitRes || elicitRes.action !== "accept") {
                try {
                  const event = timedOut
                    ? {
                        type: "mcp.elicitation",
                        phase: "timeout",
                        where: "resume-initial",
                        timeoutMs: timeoutCap,
                      }
                    : {
                        type: "mcp.elicitation",
                        phase: "completed",
                        where: "resume-initial",
                        action: elicitRes?.action || "decline",
                      };
                  process.stderr.write(JSON.stringify(event) + "\n");
                } catch {}
                if (timedOut) {
                  return {
                    isError: true,
                    name: "ElicitationError",
                    code: "ELICIT_TIMEOUT",
                    content: [
                      { type: "text", text: `Elicitation timed out after ${timeoutCap}ms` },
                    ],
                    data: { timeoutMs: timeoutCap },
                  } as any;
                }
                if (elicitRes?.action === "cancel") {
                  return {
                    isError: true,
                    name: "ElicitationError",
                    code: "ELICIT_CANCELLED",
                    content: [{ type: "text", text: "Elicitation cancelled" }],
                    data: { action: "cancel" },
                  } as any;
                }
                return {
                  isError: true,
                  name: "ElicitationError",
                  code: "ELICIT_DECLINED",
                  content: [{ type: "text", text: "Elicitation declined" }],
                  data: { action: String(elicitRes?.action || "decline") },
                } as any;
              }
              if (elicitRes && elicitRes.action === "accept") {
                let nextInv = {
                  ...(args ?? {}),
                  ["$jio.ctl.elicit.response"]: {
                    action: "accept",
                    content: elicitRes.content || {},
                    state: ctlState,
                  },
                } as any;
                while (true) {
                  let abort = false;
                  let nextCtl: any = null;
                  let nextCtlState: any = null;
                  let sinkBuf = "";
                  // heartbeat before starting resumed NDJSON run
                  notifyProgress("resume-start");
                  const sink = new Writable({
                    write(chunk, _enc, cb) {
                      try {
                        const part = Buffer.from(chunk as any).toString("utf8");
                        sinkBuf += part;
                        while (true) {
                          const nl = sinkBuf.indexOf("\n");
                          if (nl < 0) break;
                          const line = sinkBuf.slice(0, nl);
                          sinkBuf = sinkBuf.slice(nl + 1);
                          const s = line.trim();
                          if (!s) continue;
                          try {
                            let o: any = JSON.parse(s);
                            if (typeof o === "string") {
                              try {
                                o = JSON.parse(o);
                              } catch {}
                            }
                            if (o && typeof o === "object" && o["$jio.ctl"] === true) {
                              if (o["$jio.ctl.elicit"]) {
                                nextCtl = o["$jio.ctl.elicit"];
                                nextCtlState = o["$jio.ctl.elicit"]?.state;
                                abort = true;
                                continue;
                              }
                            }
                            items.push(o);
                            // per-line notifications (schema-only)
                            notifyProgress(JSON.stringify(o), 0);
                          } catch {}
                        }
                      } finally {
                        cb();
                      }
                    },
                    final(cb) {
                      cb();
                    },
                  });
                  const code2 = await runWithTransforms(
                    dir,
                    specPath as string,
                    spec as any,
                    buildArgv(spec as any, nextInv),
                    cfg as any,
                    nextInv,
                    {
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
                      stdoutTarget: sink as any,
                      stderrTarget: new PassThrough() as any,
                      inputSource: new PassThrough() as any,
                      isCancelled: () => abort,
                    } as any,
                  );
                  // heartbeat after finishing resumed run
                  notifyProgress("resume-end");
                  if (code2 && code2 !== 0) return mapExit(code2);
                  if (nextCtl) {
                    // bounded elicitation with timeout
                    const timeoutMs = Number(
                      (opts as any)?.elicitationTimeoutMs ??
                        process.env.JIO_MCP_ELICITATION_TIMEOUT_MS ??
                        30000,
                    );
                    if (Number.isFinite(timeoutMs) && timeoutMs <= 1000) {
                      try {
                        process.stderr.write(
                          JSON.stringify({
                            type: "mcp.elicitation",
                            phase: "timeout",
                            where: "resume-nextCtl-short",
                            timeoutMs,
                          }) + "\n",
                        );
                      } catch {}
                      return {
                        isError: true,
                        name: "ElicitationError",
                        code: "ELICIT_TIMEOUT",
                        content: [
                          { type: "text", text: `Elicitation timed out after ${timeoutMs}ms` },
                        ],
                        data: { timeoutMs },
                      } as any;
                    }
                    const timeoutCap = Number.isFinite(timeoutMs) ? timeoutMs : 30000;
                    let timedOut = false;
                    try {
                      process.stderr.write(
                        JSON.stringify({
                          type: "mcp.elicitation",
                          phase: "start",
                          where: "resume-nextCtl",
                        }) + "\n",
                      );
                    } catch {}
                    let th1: any;
                    const el2 = await Promise.race([
                      extra
                        .sendRequest(
                          {
                            method: "elicitation/create",
                            params: {
                              message: nextCtl?.message,
                              requestedSchema: nextCtl?.requestedSchema,
                            },
                          } as any,
                          ElicitResultSchema as any,
                        )
                        .then((x: any) => x)
                        .catch(() => null),
                      new Promise((r) => {
                        th1 = setTimeout(() => {
                          timedOut = true;
                          r(null);
                        }, timeoutCap);
                        (th1 as any)?.unref?.();
                      }),
                    ]);
                    clearTimeout(th1 as any);
                    if (!el2 || el2.action !== "accept") {
                      try {
                        const event = timedOut
                          ? {
                              type: "mcp.elicitation",
                              phase: "timeout",
                              where: "resume-nextCtl",
                              timeoutMs: timeoutCap,
                            }
                          : {
                              type: "mcp.elicitation",
                              phase: "completed",
                              where: "resume-nextCtl",
                              action: el2?.action || "decline",
                            };
                        process.stderr.write(JSON.stringify(event) + "\n");
                      } catch {}
                      if (timedOut) {
                        return {
                          isError: true,
                          name: "ElicitationError",
                          code: "ELICIT_TIMEOUT",
                          content: [
                            { type: "text", text: `Elicitation timed out after ${timeoutCap}ms` },
                          ],
                          data: { timeoutMs: timeoutCap },
                        } as any;
                      }
                      if (el2?.action === "cancel") {
                        return {
                          isError: true,
                          name: "ElicitationError",
                          code: "ELICIT_CANCELLED",
                          content: [{ type: "text", text: "Elicitation cancelled" }],
                          data: { action: "cancel" },
                        } as any;
                      }
                      const elAcc = el2 || { action: "decline" };
                      return {
                        isError: true,
                        name: "ElicitationError",
                        code: "ELICIT_DECLINED",
                        content: [{ type: "text", text: "Elicitation declined" }],
                        data: { action: String(elAcc?.action || "decline") },
                      } as any;
                    }
                    const elAcc = el2;
                    if (elAcc.action !== "accept") {
                      if (elAcc.action === "cancel") {
                        return {
                          isError: true,
                          name: "ElicitationError",
                          code: "ELICIT_CANCELLED",
                          content: [{ type: "text", text: "Elicitation cancelled" }],
                          data: { action: "cancel" },
                        } as any;
                      }
                      return {
                        isError: true,
                        name: "ElicitationError",
                        code: "ELICIT_DECLINED",
                        content: [{ type: "text", text: "Elicitation declined" }],
                        data: { action: String(elAcc?.action || "decline") },
                      } as any;
                    }
                    nextInv = {
                      ...(args ?? {}),
                      ["$jio.ctl.elicit.response"]: {
                        action: "accept",
                        content: elAcc.content || {},
                        state: nextCtlState,
                      },
                    };
                    continue;
                  }
                  break;
                }
              } else {
                return {
                  isError: true,
                  name: "ElicitationError",
                  code: "ELICIT_DECLINED",
                  content: [{ type: "text", text: "Elicitation declined" }],
                  data: { action: "decline" },
                } as any;
              }
            }
            if (validateOut) {
              const ok = validateOut({ items });
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
            return { structuredContent: { items } } as any;
          }
          // JSON output path
          let obj: any = null;
          if (out) obj = JSON.parse(out);
          if (!ignoreCtl && validateOut && obj != null) {
            const ok = validateOut(obj);
            if (!ok) {
              const err0 = (validateOut.errors && validateOut.errors[0]) || { message: "invalid" };
              return {
                isError: true,
                content: [{ type: "text", text: JSON.stringify(err0) }],
              } as any;
            }
          }
          return { structuredContent: obj } as any;
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
  try {
    const machine = createReadinessMachine({
      onComputeCaps: async () => {
        const caps = computeCapabilities({
          specs,
          transport: "stdio",
          limits: {
            maxStdoutBytes: opts.maxStdoutJsonBytes as any,
            maxStdinBytes: opts.maxStdinBytes as any,
            maxNdjsonLineBytes: opts.maxNdjsonLineBytes as any,
          },
          streamingFinalAggregate: !!opts.streamingFinalAggregate,
        });
        try {
          process.stderr.write(
            JSON.stringify({ type: "MCP_READY_CAPS", transport: "stdio", caps }) + "\n",
          );
        } catch {}
      },
      onBindTransport: async () => {},
    });
    machine.on("ready", () => {
      try {
        const ctl = { "$jio.ctl": true, "$jio.ctl.ready": { ts: Date.now() } };
        process.stderr.write(JSON.stringify(ctl) + "\n");
      } catch {}
    });
    await machine.start();
  } catch {}

  const transport = new StdioServerTransport();
  await server.connect(transport);
  try {
    // Emit a one-time startup notification to verify stdio progress delivery
    (server as any).notification?.({
      method: "notifications/progress",
      params: { message: "server-connected" },
    });
  } catch {}
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
