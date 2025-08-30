import { JSONPath } from "jsonpath-plus";

export class JsonPathExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonPathExpressionError";
  }
}

type CompiledJsonPath = {
  expr: string;
};

const CACHE_MAX = 256;
const cache = new Map<string, CompiledJsonPath>();

function enforceRfc9535(expr: string): void {
  // Very conservative guard to reject script filters/functions and eval-like tokens
  // Disallow: [? ...], (@), function calls, and backticks
  if (/\?\(|@|\blength\s*\(|`/.test(expr)) {
    throw new JsonPathExpressionError("non-RFC JSONPath features are not allowed");
  }
}

export function compileJsonPath(expression: string): CompiledJsonPath {
  const expr = String(expression || "").trim();
  if (!expr || expr[0] !== "$") {
    throw new JsonPathExpressionError("JSONPath must start with '$'");
  }
  const hit = cache.get(expr);
  if (hit) return hit;
  enforceRfc9535(expr);
  const compiled: CompiledJsonPath = { expr };
  cache.set(expr, compiled);
  if (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  return compiled;
}

export function evaluateJsonPath(compiled: CompiledJsonPath, json: unknown): unknown {
  const results = JSONPath({
    path: compiled.expr,
    json,
    wrap: true,
    resultType: "value",
    preventEval: true,
  }) as unknown[];
  if (!Array.isArray(results) || results.length === 0) {
    // Fallback: handle property-name union $['a','b',...] for plain objects
    const union = compiled.expr.match(
      /^\$\[(?:\s*(['"])((?:[^\\]|\\.)*?)\1\s*)(?:,\s*(['"])((?:[^\\]|\\.)*?)\3\s*)+\]$/,
    );
    if (union && json && typeof json === "object" && !Array.isArray(json)) {
      const re = /(['"])((?:[^\\]|\\.)*?)\1/g;
      const src = compiled.expr.slice(2, -1);
      const props: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) props.push(m[2].replace(/\\(['"])|\\/g, "$1"));
      const out: unknown[] = [];
      for (const k of props)
        if (Object.prototype.hasOwnProperty.call(json, k)) out.push((json as any)[k]);
      if (out.length === 0) return undefined;
      return out.length === 1 ? out[0] : out;
    }
    return undefined;
  }
  if (results.length === 1) return results[0];
  return results;
}

export function evaluateJsonPathString(expression: string, json: unknown): unknown {
  const compiled = compileJsonPath(expression);
  return evaluateJsonPath(compiled, json);
}
