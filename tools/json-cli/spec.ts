export type JsonCliSpec = {
  specVersion: "1.0.0";
  jsonPathDialect?: "jsonpath-plus@8";
  schemaDialect?: "https://json-schema.org/draft/2020-12/schema";
  tool: ToolSection;
  command: CommandSection;
};

export type ToolSection = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: any;
  outputSchema?: any;
};

export type CommandSection = {
  package: string;
  exec: string;
  workingDir?: string;
  env?: Record<string, string>;
  defaultBooleanStyle?: "presence" | "equals";
  timeoutMs?: number;
  parameters: Record<string, ParameterSpec>;
  stdinTransform?: { shell: string; format: "ndjson" | "json" };
  stdoutTransform: { shell: string; format: "ndjson" | "json" };
  onValidationFailure?: { shell: string };
};

export type ParameterSpec =
  | ({ value: string; type: BaseTypes } & BaseParam)
  | ({ path: string; type: BaseTypes } & BaseParam);

type BaseTypes = "string" | "number" | "boolean" | "array" | "object";

type BaseParam = {
  required?: boolean;
  default?: any;
  position?: number; // for positionals
  flag?: boolean; // for flags
  flagName?: string; // required when flag=true
  booleanStyle?: "presence" | "equals";
  collectionStyle?: "repeatArg" | "repeatFlag" | "csv" | "kv" | "separate";
  csvSeparator?: string;
};

export type JsonCliSpecInput = Omit<
  JsonCliSpec,
  "specVersion" | "jsonPathDialect" | "schemaDialect"
> &
  Partial<Pick<JsonCliSpec, "specVersion" | "jsonPathDialect" | "schemaDialect">>;

export function defineToolSpec(spec: JsonCliSpecInput): JsonCliSpec {
  return {
    specVersion: spec.specVersion ?? "1.0.0",
    jsonPathDialect: spec.jsonPathDialect ?? "jsonpath-plus@8",
    schemaDialect: spec.schemaDialect ?? "https://json-schema.org/draft/2020-12/schema",
    tool: spec.tool,
    command: spec.command,
  };
}
