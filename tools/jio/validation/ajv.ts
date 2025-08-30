import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import { compileJsonPath } from "../jsonpath/index.ts";

export function createAjv(): Ajv {
  const ajv = new Ajv({
    strict: true,
    allErrors: true,
    $data: true,
    allowUnionTypes: true,
    coerceTypes: false,
    useDefaults: true,
    removeAdditional: false,
  });
  addFormats(ajv);
  ajv.addFormat("jsonpath", {
    type: "string",
    validate: (s: string) => {
      try {
        compileJsonPath(s);
        return true;
      } catch {
        return false;
      }
    },
  });
  return ajv;
}

export function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message || ""}`.trim());
}
