import Ajv from "ajv";
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
    const { dir, cfg, specs, index } = await discoverJioTools();
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
    const keyForId = (id: any): string => (typeof id === "string" ? id : String(id));
    try {
      (mcp as any).server?.setNotificationHandler?.(
        CancelledNotificationSchema,
        async (notification: any) => {
          const id = notification?.params?.requestId;
          if (id !== undefined && id !== null) inflight.set(keyForId(id), { cancelled: true });
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

      let maybeParams: any | undefined = undefined;
      let maybeOutput: any | undefined = undefined;
      if (inputSchema && process.env.JIO_MCP_ZOD !== "0") {
        const conv = await jsonSchemaToZodSafe(inputSchema);
        const shape = conv.zod ? getZodRawShape(conv.zod) : null;
        if (shape) maybeParams = shape;
      }
      if (outputSchema && process.env.JIO_MCP_ZOD !== "0") {
        const conv = await jsonSchemaToZodSafe(outputSchema);
        const shape = conv.zod ? getZodRawShape(conv.zod) : null;
        if (shape) maybeOutput = shape;
      }

      const registerWith = (cb: any) => {
        if (maybeParams || maybeOutput) {
          return (mcp as any).registerTool(
            fq,
            {
              description,
              inputSchema: maybeParams,
              outputSchema: maybeOutput,
            },
            cb,
          );
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
            type: "error",
            error: { type: "Error", message: String(e?.message || "Server busy") },
          } as any;
        }
        try {
          const explicitId = extra?.request?.id as any;
          const reqId =
            explicitId ?? (extra && (extra.relatedRequestId ?? extra.id ?? extra.requestId));
          const k = reqId !== undefined ? keyForId(reqId) : undefined;
          if (k !== undefined && !inflight.has(k)) inflight.set(k, { cancelled: false });
          if (k !== undefined && inflight.get(k)?.cancelled) {
            return { isError: true, content: [{ type: "text", text: "cancelled" }] } as any;
          }
          // Hold permit briefly for concurrency testing if configured
          try {
            const d = Number(process.env.JIO_MCP_TEST_DELAY_MS || "0");
            if (Number.isFinite(d) && d > 0) await new Promise((r) => setTimeout(r, d));
          } catch {}
          // Strip non-schema meta keys before validation
          const argsForValidation = args && typeof args === "object" ? { ...args } : args;
          if (argsForValidation && typeof argsForValidation === "object") {
            delete (argsForValidation as any)._meta;
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
              error: { type: "InvalidInput", message: JSON.stringify(err) },
            } as any;
          }
          // Request-time control: allow clients to ask for elicitation explicitly
          if (args?._meta?.elicit === true) {
            return {
              control: {
                elicit: { message: "confirmation requested", confirmProperty: "confirm" },
              },
            } as any;
          }
          const specPath = (index as Map<string, string>).get(fq);
          if (!specPath)
            return { type: "error", error: { type: "NotFound", message: "spec not found" } } as any;
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
            outStream.on("data", (b) => (out += Buffer.from(b as any).toString("utf8")));
          }
          // Custom sink to ensure all writes are observed before returning
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
                        const obj = JSON.parse(trailing);
                        if (
                          !ignoreCtl &&
                          obj &&
                          typeof obj === "object" &&
                          obj["$jio.ctl"] === true
                        ) {
                          if (obj["$jio.ctl.elicit"]) {
                            ctlPayload = obj["$jio.ctl.elicit"];
                            sawCtl = true;
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
          const progressToken = args?._meta?.progressToken;
          const ignoreCtl =
            spec.command?.ignoreControlMessages === true ||
            args?._meta?.ignoreControlMessages === true;
          const specForRun = ignoreCtl
            ? { ...spec, tool: { ...(spec.tool || {}), outputSchema: undefined } }
            : spec;
          const code = await runWithTransforms(
            dir,
            specPath,
            specForRun as any,
            argv,
            cfg as any,
            invObj,
            {
              collect: !shouldStreamNdjson,
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
              stdoutTarget: (ndjsonSink as any) || (outStream as any),
              stderrTarget: errStream as any,
              inputSource: inStream as any,
              isCancelled: () => (k !== undefined && inflight.get(k)?.cancelled) || false,
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
          if (shouldStreamNdjson && !ignoreCtl && sawCtl && ctlPayload) {
            return { control: { elicit: ctlPayload } } as any;
          }
          if (code && code !== 0) return mapExit(code);
          try {
            const ignoreCtl =
              spec.command?.ignoreControlMessages === true ||
              args?._meta?.ignoreControlMessages === true;
            let obj: any = null;
            if (shouldStreamNdjson) {
              // If control was observed, return control result.
              if (!ignoreCtl && sawCtl && ctlPayload) {
                return { control: { elicit: ctlPayload } } as any;
              }
              // Flush trailing line if any
              const trailing = lineBuf.trim();
              if (trailing) {
                try {
                  const o = JSON.parse(trailing);
                  streamedItems.push(o);
                  notifyItem(o);
                } catch {}
              }
              // For streaming mode, still provide a final structuredContent for convenience.
              obj = streamedItems.slice();
            } else if (out) {
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
                  return { control: { elicit: ctl["$jio.ctl.elicit"] } } as any;
                }
              } else if (isCtlObj(obj) && obj["$jio.ctl.elicit"]) {
                return { control: { elicit: obj["$jio.ctl.elicit"] } } as any;
              }
            }
            if (!ignoreCtl && validateOut && obj != null) {
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
            if (k !== undefined && inflight.get(k)?.cancelled) {
              return { isError: true, content: [{ type: "text", text: "cancelled" }] } as any;
            }
            // optional progress completion notice if client requested and no control
            try {
              if (process.env.JIO_MCP_PROGRESS !== "0") {
                const token = args?._meta?.progressToken;
                if (token && (mcp as any).server?.notification) {
                  try {
                    await (mcp as any).server.notification(
                      ProgressNotificationSchema.parse({
                        method: "notifications/progress",
                        params: { progress: 1, message: "done", progressToken: token },
                      }),
                    );
                  } catch {
                    await (mcp as any).server.notification({
                      method: "notifications/progress",
                      params: { progress: 1, message: "done", progressToken: token },
                    });
                  }
                }
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
    await mcp.connect(transport as any);

    const httpServer = createServer(async (req, res) => {
      try {
        if (req.method === "GET" && req.url === "/health") {
          const body = JSON.stringify({ ok: true });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(body);
          return;
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
    if (inputSchema && process.env.JIO_MCP_ZOD !== "0") {
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

    if (outputSchema && process.env.JIO_MCP_ZOD !== "0") {
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
          delete (argsForValidation as any)._meta;
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
        const code = await runWithTransforms(dir, specPath, spec as any, argv, cfg as any, invObj, {
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
        } as any);
        if (code && code !== 0) return mapExit(code);
        try {
          let obj: any = null;
          const ignoreCtl =
            spec.command?.ignoreControlMessages === true ||
            args?._meta?.ignoreControlMessages === true;
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
                  structuredContent: undefined,
                  control: { elicit: ctl["$jio.ctl.elicit"] },
                } as any;
              }
            } else if (isCtlObj(obj) && obj["$jio.ctl.elicit"]) {
              return {
                structuredContent: undefined,
                control: { elicit: obj["$jio.ctl.elicit"] },
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
    error: {
      type: getErrorTypeFromExitCode(code),
      message: `jio exited with code ${code}`,
    },
  } as any;
}
