// Ensure zx globals are available even when running from a temp dir without node_modules
// Compute workspace root from this file's location (repo/tools/dev/zx-init.mjs)
const urlMod = await import("node:url");
const pathMod = await import("node:path");
const here = urlMod.fileURLToPath(import.meta.url);
const WORKSPACE_ROOT_FIXED = pathMod.dirname(pathMod.dirname(pathMod.dirname(here)));
// Ensure zx globals are available as early as possible via bare import using NODE_PATH
// This covers cases where workspace/node_modules is not present in sandboxes but NODE_PATH points
// to a host workspace node_modules. Fail silently if not available; other strategies follow.
try {
  await import("zx/globals");
} catch {}

// (intentionally no global NIX_CONFIG mutations here; .envrc handles quieting nix)

// Best-effort absolute URL to zx globals for resolver to use
let ZX_GLOBALS_URL = "";

try {
  const zxPath = pathMod.resolve(WORKSPACE_ROOT_FIXED, "node_modules/zx/build/globals.cjs");
  const zxUrl = urlMod.pathToFileURL(zxPath).href;
  await import(zxUrl);
  ZX_GLOBALS_URL = zxUrl;
  try {
    process.env.ZX_GLOBALS_URL = zxUrl;
  } catch {}
} catch {
  // Try to locate zx via the nix-provided zx-wrapper on PATH and import its globals.js
  try {
    const fs = await import("node:fs/promises");
    const pathSep = process.platform === "win32" ? ";" : ":";
    const parts = String(process.env.PATH || "")
      .split(pathSep)
      .filter(Boolean);
    let zxw = "";
    for (const p of parts) {
      const candidate = pathMod.join(
        p,
        process.platform === "win32" ? "zx-wrapper.cmd" : "zx-wrapper",
      );
      try {
        await fs.access(candidate);
        zxw = candidate;
        break;
      } catch {}
    }
    if (zxw) {
      const content = await fs.readFile(zxw, "utf8");
      // Match --import[=| ]'<path>/node_modules/zx/build/globals.(cjs|js)'
      const re =
        /--import(?:=|\s+)(['\"]?)([^'\"\s]*\/node_modules\/zx\/build\/globals\.(?:cjs|js))\1/;
      const m = content.match(re);
      if (m && m[2]) {
        const zxGlobalsPath = m[2];
        try {
          const zxUrl = urlMod.pathToFileURL(zxGlobalsPath).href;
          await import(zxUrl);
          ZX_GLOBALS_URL = zxUrl;
          try {
            process.env.ZX_GLOBALS_URL = zxUrl;
          } catch {}
        } catch {}
      }
    }
  } catch {}
  // Final fallback: import zx/globals directly to register globals when available via NODE_PATH
  try {
    await import("zx/globals");
    ZX_GLOBALS_URL = "";
    try {
      process.env.ZX_GLOBALS_URL = "";
    } catch {}
  } catch {}
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
        const zxResolved = ${JSON.stringify(ZX_GLOBALS_URL)};
        if (zxResolved && zxResolved.length > 0) {
          return await nextResolve(zxResolved, context);
        }
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
      // Prefer Node's CJS resolver first to respect package "exports" fields via createRequire
      try {
        const { createRequire } = await import('node:module');
        const { pathToFileURL } = await import('node:url');
        const req = createRequire(new URL('package.json', baseUrl));
        const resolved = req.resolve(specifier);
        const href = pathToFileURL(resolved).href;
        return await nextResolve(href, context);
      } catch {}
      const candidateDir = new URL('node_modules/' + specifier, baseUrl).href;
      try { return await nextResolve(candidateDir, context); } catch {}
      // Try common index.js locations
      const candidates = [
        'node_modules/' + specifier + '/index.js',
        'node_modules/' + specifier + '/dist/index.js',
        'node_modules/' + specifier + '/lib/index.js',
        'node_modules/' + specifier + '/esm/index.js',
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
