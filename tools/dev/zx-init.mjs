import "zx/globals";

const { register } = await import("node:module");
const { pathToFileURL } = await import("node:url");

// Prefer resolving relative imports from the repository root so V8 URLs map to real paths
const root = process.env.WORKSPACE_ROOT || process.cwd();
const src = `export async function resolve(specifier, context, nextResolve) {
  try {
    const isRel = specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/');
    const base = new URL(context.parentURL || 'file:///');
    base.pathname = '${root}'.endsWith('/') ? '${root}' : '${root}/';
    if (isRel) {
      const last = new URL(specifier, base).pathname.split('/').pop() || '';
      if (!/\\.[a-zA-Z0-9]+$/.test(last)) {
        const withTs = new URL(specifier + '.ts', base).href;
        return await nextResolve(withTs, context);
      }
    }
  } catch {}
  return nextResolve(specifier, context);
}`;
const dataUrl = "data:text/javascript," + encodeURIComponent(src);
register(dataUrl, pathToFileURL(root.endsWith("/") ? root : root + "/"));
