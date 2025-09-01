import Ajv from "ajv";
import {
  buildArgv,
  discoverJioTools,
  generateInputSchemaFromParameters,
  runWithTransforms,
  type RootConfig,
  type ToolSpec,
} from "../core/index.ts";

export type McpServerOpts = {
  transport?: "stdio";
  httpHost?: string;
  httpPort?: number;
  timeoutMs?: number;
  collectLimit?: number;
  collectBytes?: number;
  cleanEnv?: boolean;
  passEnv?: string[];
  setEnv?: Record<string, string>;
};

export async function startMcpServer(
  opts: McpServerOpts = {},
): Promise<{ close?: () => Promise<void> }> {
  if (opts.transport === "http") {
    const { createServer } = await import("node:http");
    const host = opts.httpHost || "127.0.0.1";
    const port = Number.isFinite(opts.httpPort as number) ? (opts.httpPort as number) : 3000;
    const server = createServer(async (req, res) => {
      try {
        if (req.method === "GET" && req.url === "/health") {
          const body = JSON.stringify({ ok: true });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(body);
          return;
        }
        // Placeholder endpoint: non-streaming JSON case
        if (req.method === "POST" && req.url === "/call") {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(Buffer.from(c as any));
          // We don't execute tools in PR3 skeleton; return minimal json
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
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
    await new Promise<void>((res) => server.listen(port, host, () => res()));
    // In background, warm up discovery for future endpoints (non-blocking)
    void (async () => {
      try {
        await discoverJioTools();
      } catch {}
    })();
    return {
      close: async () =>
        new Promise<void>((res, rej) => {
          try {
            server.close((err: any) => (err ? rej(err) : res()));
          } catch (e) {
            res();
          }
        }),
    };
  }
  // default to stdio using MCP SDK
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { dir, cfg, specs } = await discoverJioTools();
  const server = new McpServer({ name: "jio-mcp", version: "0.1.0" });
  const ajv = new Ajv({ strict: true, allErrors: true });

  for (const [fq, spec] of specs) {
    const inputSchema = spec.tool?.inputSchema || generateInputSchemaFromParameters(spec);
    const description = spec.tool?.description || fq;
    const validateIn = inputSchema ? ajv.compile(inputSchema) : null;

    server.tool({
      name: fq,
      description,
      schema: inputSchema || { type: "object" },
      handler: async ({ args }) => {
        try {
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

          // Execute via jio CLI in a child process so MCP stdio remains clean.
          const { spawn } = await import("node:child_process");
          const { tmpdir } = await import("node:os");
          const { writeFile, mkdtemp } = await import("node:fs/promises");
          const { join } = await import("node:path");
          const tmp = await mkdtemp(join(tmpdir(), "jio-mcp-"));
          const inPath = join(tmp, "invocation.json");
          await writeFile(inPath, JSON.stringify(args ?? {}), "utf8");
          const isNdjson = spec.command?.stdoutTransform?.format === "ndjson";
          const cliArgs: string[] = [fq, "--in", inPath];
          if (isNdjson) cliArgs.push("--collect");
          if (typeof opts.timeoutMs === "number")
            cliArgs.push("--timeout-ms", String(opts.timeoutMs));
          if (typeof opts.collectLimit === "number")
            cliArgs.push("--collect-limit", String(opts.collectLimit));
          if (typeof opts.collectBytes === "number")
            cliArgs.push("--collect-bytes", String(opts.collectBytes));
          if (opts.cleanEnv === false) cliArgs.push("--no-clean-env");
          for (const name of opts.passEnv || []) cliArgs.push("--pass-env", name);
          for (const [k, v] of Object.entries(opts.setEnv || {}))
            cliArgs.push("--env", `${k}=${v}`);
          const p = spawn("jio", cliArgs, { stdio: ["ignore", "pipe", "pipe"] });
          let out = "";
          let err = "";
          p.stdout.on("data", (b: any) => (out += Buffer.from(b).toString("utf8")));
          p.stderr.on("data", (b: any) => (err += Buffer.from(b).toString("utf8")));
          const code: number = await new Promise((res) => p.on("close", (c) => res(c ?? 0)));
          if (code && code !== 0) return mapExit(code);
          try {
            const obj = out ? JSON.parse(out) : null;
            return { type: "json", content: obj } as any;
          } catch {
            // If output wasn't JSON, return an error with captured stderr snippet
            return {
              type: "error",
              error: { type: "OutputParseError", message: err || "invalid JSON output" },
            } as any;
          }
        } catch (e: any) {
          return {
            type: "error",
            error: { type: "TransformError", message: String(e?.message || e) },
          } as any;
        }
      },
    });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export function mapExit(code: number) {
  const type =
    code === 1
      ? "InvalidInput"
      : code === 65
        ? "TransformError"
        : code === 66
          ? "NotFound"
          : code === 69
            ? "SpawnError"
            : code === 78
              ? "ConfigError"
              : code === 124
                ? "Timeout"
                : "Error";
  return { type: "error", error: { type, message: `jio exited with code ${code}` } } as any;
}
