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
  timeoutMs?: number;
  collectLimit?: number;
  collectBytes?: number;
  cleanEnv?: boolean;
  passEnv?: string[];
  setEnv?: Record<string, string>;
};

export async function startMcpServer(opts: McpServerOpts = {}) {
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

          const argv = buildArgv(spec as ToolSpec, args);
          const code = await runWithTransforms(
            dir,
            "",
            spec as ToolSpec,
            argv,
            cfg as RootConfig,
            args,
            {
              collect: spec.command?.stdoutTransform?.format === "ndjson",
              collectLimit: opts.collectLimit,
              limits: {
                collectItems: opts.collectLimit,
                collectBytes: opts.collectBytes,
              },
              timeoutMsOverride: opts.timeoutMs,
              cleanEnv: opts.cleanEnv !== false,
              passEnv: opts.passEnv || [],
              setEnv: opts.setEnv || {},
            },
          );
          if (code && code !== 0) return mapExit(code);
          // For JSON, the runner wrote the JSON document to stdout; for collected NDJSON, it wrote an array.
          // We cannot capture directly here without refactoring runWithTransforms; rely on caller capture.
          return { type: "json", content: null } as any;
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

function mapExit(code: number) {
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
