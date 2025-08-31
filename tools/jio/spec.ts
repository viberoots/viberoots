import type {
  JsonCliSpec as CanonJsonCliSpec,
  JsonCliSpecInput as CanonJsonCliSpecInput,
  ParameterSpec,
} from "./schema/types";

export type JsonCliSpec = CanonJsonCliSpec;

export type ParameterSpec = ParameterSpec;

export type JsonCliSpecInput = CanonJsonCliSpecInput;

export function defineToolSpec(spec: JsonCliSpecInput): JsonCliSpec {
  return {
    specVersion: spec.specVersion ?? "1.0.0",
    schemaDialect: spec.schemaDialect ?? "https://json-schema.org/draft/2020-12/schema",
    tool: spec.tool,
    command: spec.command,
  };
}
