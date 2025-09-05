import { emitZodWarning, getZodRawShape, jsonSchemaToZodSafe } from "./schema.ts";

export type BuildSdkSchemasOptions = {
  isNdjson: boolean;
  streamingFinalAggregate: boolean;
  toolFqName: string;
  inputSchema?: any;
  outputSchema?: any;
};

export type BuildSdkSchemasResult = {
  paramsZodForSdk?: any;
  outputZodForSdk?: any;
  itemZodForValidation?: any;
};

export function isZodType(value: unknown): boolean {
  try {
    return !!(
      value &&
      typeof value === "object" &&
      (typeof (value as any).parse === "function" || typeof (value as any)._parse === "function")
    );
  } catch {
    return false;
  }
}

export function isZodRawShapeValid(shape: unknown): boolean {
  try {
    if (!shape || typeof shape !== "object" || Array.isArray(shape)) return false;
    for (const k of Object.keys(shape as any)) {
      const v: any = (shape as any)[k];
      if (!isZodType(v)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function buildSdkSchemas(
  opts: BuildSdkSchemasOptions,
): Promise<BuildSdkSchemasResult> {
  const { inputSchema, outputSchema, isNdjson, streamingFinalAggregate, toolFqName } = opts;
  let paramsZodForSdk: any | undefined = undefined;
  let outputZodForSdk: any | undefined = undefined;
  let itemZodForValidation: any | undefined = undefined;

  // Input
  if (inputSchema) {
    const conv = await jsonSchemaToZodSafe(inputSchema);
    if (conv.zod) {
      const shape = getZodRawShape(conv.zod);
      if (shape && typeof shape === "object") {
        if (isZodRawShapeValid(shape)) {
          paramsZodForSdk = shape;
        } else {
          emitZodWarning({
            tool: toolFqName,
            reasons: [{ keyword: "zodShape(memberInvalid)", pointer: "" }],
            schema: inputSchema,
            kind: "input",
          });
        }
      }
    } else if (conv.reasons && conv.reasons.length) {
      emitZodWarning({
        tool: toolFqName,
        reasons: conv.reasons,
        schema: inputSchema,
        kind: "input",
      });
    }
  }

  // Output
  if (outputSchema) {
    const conv = await jsonSchemaToZodSafe(outputSchema);
    if (conv.zod) {
      const shape = getZodRawShape(conv.zod);
      if (shape && typeof shape === "object") {
        if (isZodRawShapeValid(shape)) {
          outputZodForSdk = shape;
        } else {
          emitZodWarning({
            tool: toolFqName,
            reasons: [{ keyword: "zodShape(memberInvalid)", pointer: "" }],
            schema: outputSchema,
            kind: "output",
          });
        }
      } else {
        emitZodWarning({
          tool: toolFqName,
          reasons: [{ keyword: "rootType(non-object)", pointer: "" }],
          schema: outputSchema,
          kind: "output",
        });
      }
      itemZodForValidation = conv.zod;
    } else if (conv.reasons && conv.reasons.length) {
      emitZodWarning({
        tool: toolFqName,
        reasons: conv.reasons,
        schema: outputSchema,
        kind: "output",
      });
    }
  }

  // NDJSON policy
  if (isNdjson) {
    if (streamingFinalAggregate) {
      try {
        const { z } = await import("zod");
        const itemZod = itemZodForValidation;
        if (itemZod && typeof itemZod === "object") {
          const arrayZod =
            itemZod._def?.typeName === "ZodArray" ? itemZod : (z as any).array?.(itemZod) || null;
          if (
            arrayZod &&
            (typeof (arrayZod as any).parse === "function" ||
              typeof (arrayZod as any)._parse === "function")
          ) {
            const wrapper = { items: arrayZod } as any;
            outputZodForSdk = isZodRawShapeValid(wrapper) ? wrapper : undefined;
          } else {
            outputZodForSdk = undefined;
          }
        } else {
          outputZodForSdk = undefined;
        }
      } catch {
        outputZodForSdk = undefined;
      }
    } else {
      outputZodForSdk = undefined;
    }
  }

  return { paramsZodForSdk, outputZodForSdk, itemZodForValidation };
}
