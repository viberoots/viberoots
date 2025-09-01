import Ajv from "ajv";
import { PassThrough } from "node:stream";
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
            { description, inputSchema: maybeParams, outputSchema: maybeOutput },
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
          if (validateIn && !validateIn(args)) {
            const err = (validateIn.errors && validateIn.errors[0]) || { message: "invalid" };
            return {
              type: "error",
              error: { type: "InvalidInput", message: JSON.stringify(err) },
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
          // PR3.1: collect outputs to return a single JSON document over HTTP
          const outStream = new PassThrough();
          const errStream = new PassThrough();
          const inStream = new PassThrough();
          let out = "";
          let err = "";
          outStream.on("data", (b) => (out += Buffer.from(b as any).toString("utf8")));
          errStream.on("data", (b) => (err += Buffer.from(b as any).toString("utf8")));
          const progressToken = args?._meta?.progressToken;
          const code = await runWithTransforms(
            dir,
            specPath,
            spec as any,
            argv,
            cfg as any,
            invObj,
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
              stdoutTarget: outStream as any,
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
          if (code && code !== 0) return mapExit(code);
          // optional progress completion notice if client requested
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
          try {
            const obj = out ? JSON.parse(out) : null;
            if (validateOut && obj != null) {
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
            return { structuredContent: obj } as any;
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
  // PR4: apply same limits and optional concurrency gate for stdio
  const maxConcurrent = Number.isFinite(opts.maxConcurrentCalls as number)
    ? Math.max(0, opts.maxConcurrentCalls as number)
    : 0;
  let inFlight = 0;
  const tryAcquire = (): boolean => {
    if (!maxConcurrent) return true;
    if (inFlight < maxConcurrent) {
      inFlight++;
      return true;
    }
    return false;
  };
  const release = () => {
    if (maxConcurrent) inFlight = Math.max(0, inFlight - 1);
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
        // Prefer config-style API when we have any schema to pass explicitly
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
      try {
        if (!tryAcquire()) {
          return { type: "error", error: { type: "Error", message: "Server busy" } } as any;
        }
        if (validateIn && !validateIn(args)) {
          const err = (validateIn.errors && validateIn.errors[0]) || { message: "invalid" };
          return {
            type: "error",
            error: {
              type: "InvalidInput",
              message: JSON.stringify(err),
            },
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
          const obj = out ? JSON.parse(out) : null;
          if (validateOut && obj != null) {
            const ok = validateOut(obj);
            if (!ok) {
              const err = (validateOut.errors && validateOut.errors[0]) || { message: "invalid" };
              return {
                isError: true,
                content: [{ type: "text", text: JSON.stringify(err) }],
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
          release();
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
