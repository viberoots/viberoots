// Ensure zx globals are available even when running from a temp dir without node_modules
// Compute workspace root from this file's location (repo/tools/dev/zx-init.mjs)
const urlMod = await import("node:url");
const pathMod = await import("node:path");
const here = urlMod.fileURLToPath(import.meta.url);
const WORKSPACE_ROOT_FIXED = pathMod.dirname(pathMod.dirname(pathMod.dirname(here)));

const alreadyInit = globalThis.__ZX_INIT_ACTIVE === true;
if (!alreadyInit) {
  try {
    Object.defineProperty(globalThis, "__ZX_INIT_ACTIVE", {
      value: true,
      configurable: false,
      writable: false,
    });
  } catch {}
  try {
    const zxPath = pathMod.resolve(WORKSPACE_ROOT_FIXED, "node_modules/zx/build/globals.cjs");
    await import(urlMod.pathToFileURL(zxPath).href);
  } catch {
    try {
      await import("zx/globals");
    } catch {}
  }
}

const { register } = await import("node:module");
const { pathToFileURL } = await import("node:url");
const fsp = await import("node:fs/promises");
const pathMod2 = await import("node:path");

//

// Minimal resolver:
// 1) Append .ts to relative/absolute specifiers lacking an extension.
// 2) Fall back to resolving bare imports by searching NODE_PATH entries, then repo node_modules.
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
    // Fallback: treat bare specifiers as coming from NODE_PATH or workspace node_modules
    try {
      // Special-case zx bare import; prefer the flake-provided globals file
      if (specifier === 'zx' || specifier === 'zx/globals' || specifier === 'zx/globals.cjs') {
        const ws = '${WORKSPACE_ROOT_FIXED}'.endsWith('/') ? '${WORKSPACE_ROOT_FIXED}' : '${WORKSPACE_ROOT_FIXED}/';
        const baseUrl = new URL(ws, base);
        const zxGlobals = new URL('node_modules/zx/build/globals.cjs', baseUrl).href;
        return await nextResolve(zxGlobals, context);
      }
      const envPath = (process.env.NODE_PATH || '').split('${process.platform === "win32" ? ";" : ":"}').filter(Boolean);
      for (const entry of envPath) {
        const baseUrl = new URL(entry.endsWith('/') ? entry : entry + '/', base);
        const candidate = new URL(specifier, baseUrl).href;
        try { return await nextResolve(candidate, context); } catch {}
        const candidateDir = new URL(specifier + '/index.js', baseUrl).href;
        try { return await nextResolve(candidateDir, context); } catch {}
      }
      const ws = '${WORKSPACE_ROOT_FIXED}'.endsWith('/') ? '${WORKSPACE_ROOT_FIXED}' : '${WORKSPACE_ROOT_FIXED}/';
      const baseUrl = new URL(ws, base);
      const candidateDir = new URL('node_modules/' + specifier, baseUrl).href;
      try { return await nextResolve(candidateDir, context); } catch {}
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
register(
  dataUrl,
  pathToFileURL(
    WORKSPACE_ROOT_FIXED.endsWith("/") ? WORKSPACE_ROOT_FIXED : WORKSPACE_ROOT_FIXED + "/",
  ),
);

//
