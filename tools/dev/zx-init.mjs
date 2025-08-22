import "zx/globals";

// Patch $ to default to stdio: 'inherit' for template-tag calls
if (globalThis.$) {
  const $orig = globalThis.$;
  const isTemplateCall = (first) =>
    Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, "raw");
  const $patched = (...args) => {
    if (isTemplateCall(args[0])) {
      return $orig({ stdio: "inherit" })(...args);
    }
    return $orig(...args);
  };
  Object.assign($patched, $orig);
  globalThis.$ = $patched;
}

// Register a tiny ESM resolver for extensionless relative imports to .ts
try {
  const { register } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const src = `export async function resolve(specifier, context, nextResolve) { try { const rel = specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/'); const base = context.parentURL || 'file:///'; if (rel) { const last = new URL(specifier, base).pathname.split('/').pop() || ''; if (!/\\.[a-zA-Z0-9]+$/.test(last)) { const withTs = new URL(specifier + '.ts', base).href; return await nextResolve(withTs, context); } } } catch {} return nextResolve(specifier, context); }`;
  const dataUrl = "data:text/javascript," + encodeURIComponent(src);
  register(dataUrl, pathToFileURL(process.cwd() + "/"));
} catch {}
