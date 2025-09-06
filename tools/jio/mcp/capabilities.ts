import { createHash } from "node:crypto";

export type TransportKind = "stdio" | "http";

export type CapabilityLimits = {
  maxItems?: number;
  maxStdoutBytes?: number;
  maxStdinBytes?: number;
  maxNdjsonLineBytes?: number;
};

export type McpToolCapability = {
  fqName: string;
  input: { present: boolean; schemaHash?: string | null };
  output: {
    present: boolean;
    schemaHash?: string | null;
    format: "json" | "ndjson";
    aggregate: "array" | "object" | null;
  };
  supports: {
    elicitation: boolean;
    progress: boolean;
    notifications: boolean;
  };
  limits?: CapabilityLimits;
};

export type McpCapabilities = {
  protocolVersion: string;
  transport: TransportKind;
  transports: { stdio?: CapabilityLimits; http?: CapabilityLimits };
  tools: McpToolCapability[];
};

function sha256(obj: any): string | null {
  try {
    const s = JSON.stringify(obj);
    return createHash("sha256").update(s).digest("hex");
  } catch {
    return null;
  }
}

export function computeCapabilities(args: {
  specs: Map<string, any>;
  transport: TransportKind;
  limits?: CapabilityLimits;
  streamingFinalAggregate?: boolean;
}): McpCapabilities {
  const { specs, transport, limits, streamingFinalAggregate } = args;
  const tools: McpToolCapability[] = [];
  for (const [fqName, spec] of specs) {
    const inputSchema = spec?.tool?.inputSchema;
    const outputSchema = spec?.tool?.outputSchema;
    const isNdjson = spec?.command?.stdoutTransform?.format === "ndjson";
    const aggregate: "array" | "object" | null = isNdjson
      ? streamingFinalAggregate
        ? "array"
        : null
      : null;
    tools.push({
      fqName,
      input: { present: !!inputSchema, schemaHash: inputSchema ? sha256(inputSchema) : null },
      output: {
        present: !!outputSchema,
        schemaHash: outputSchema ? sha256(outputSchema) : null,
        format: isNdjson ? "ndjson" : "json",
        aggregate,
      },
      supports: {
        elicitation: true,
        progress: true,
        notifications: true,
      },
      limits: limits ? { ...limits } : undefined,
    });
  }
  tools.sort((a, b) => (a.fqName < b.fqName ? -1 : a.fqName > b.fqName ? 1 : 0));
  const transports: any = {};
  if (transport === "stdio") transports.stdio = limits ? { ...limits } : {};
  if (transport === "http") transports.http = limits ? { ...limits } : {};
  return {
    protocolVersion: "0",
    transport,
    transports,
    tools,
  };
}

export function serializeCapabilities(caps: McpCapabilities): any {
  // Ensure deterministic order for comparison/logging
  const sorted: any = {
    protocolVersion: caps.protocolVersion,
    transport: caps.transport,
    transports: caps.transports,
    tools: [...caps.tools].sort((a, b) => (a.fqName < b.fqName ? -1 : a.fqName > b.fqName ? 1 : 0)),
  };
  return sorted;
}
