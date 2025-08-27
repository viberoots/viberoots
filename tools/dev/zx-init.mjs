import "zx/globals";

const { register } = await import("node:module");
const { pathToFileURL } = await import("node:url");

// Minimal resolver:
// 1) Append .ts to relative/absolute specifiers lacking an extension.
// 2) Fall back to resolving bare imports from WORKSPACE_ROOT/node_modules when default resolution fails.
const root = process.env.WORKSPACE_ROOT || process.cwd();
const src = `export async function resolve(specifier, context, nextResolve) {
  const base = new URL(context.parentURL || 'file:///');
  try {
    const isRelOrAbs = specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/');
    if (isRelOrAbs) {
      const last = new URL(specifier, base).pathname.split('/').pop() || '';
      if (!/\\.[a-zA-Z0-9]+$/.test(last)) {
        const withTs = new URL(specifier + '.ts', base).href;
        return await nextResolve(withTs, context);
      }
    }
    // Try default resolution first
    return await nextResolve(specifier, context);
  } catch (e) {
    // Fallback: treat bare specifiers as coming from workspace node_modules
    try {
      const root = '${root}'.endsWith('/') ? '${root}' : '${root}/';
      const baseUrl = new URL(root, base);
      const candidateDir = new URL('node_modules/' + specifier, baseUrl).href;
      try {
        return await nextResolve(candidateDir, context);
      } catch {}
      // Try common index.js locations
      const candidates = [
        'node_modules/' + specifier + '/index.js',
        'node_modules/' + specifier + '/dist/index.js',
        'node_modules/' + specifier + '/lib/index.js',
      ];
      for (const rel of candidates) {
        try {
          const href = new URL(rel, baseUrl).href;
          return await nextResolve(href, context);
        } catch {}
      }
    } catch {}
  }
  return nextResolve(specifier, context);
}`;
const dataUrl = "data:text/javascript," + encodeURIComponent(src);
register(dataUrl, pathToFileURL(root.endsWith("/") ? root : root + "/"));
