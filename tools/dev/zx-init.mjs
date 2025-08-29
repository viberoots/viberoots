// Ensure zx globals are available even when running from a temp dir without node_modules
// Compute workspace root from this file's location (repo/tools/dev/zx-init.mjs)
const urlMod = await import("node:url");
const pathMod = await import("node:path");
const here = urlMod.fileURLToPath(import.meta.url);
const WORKSPACE_ROOT_FIXED = pathMod.dirname(pathMod.dirname(pathMod.dirname(here)));

try {
  const zxPath = pathMod.resolve(WORKSPACE_ROOT_FIXED, "node_modules/zx/build/globals.cjs");
  await import(urlMod.pathToFileURL(zxPath).href);
} catch {
  // Fallback: let default/bare resolution try via NODE_PATH or local node_modules
  try {
    await import("zx/globals");
  } catch {}
}

const { register } = await import("node:module");
const { pathToFileURL } = await import("node:url");
const fsp = await import("node:fs/promises");
const pathMod2 = await import("node:path");

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

// Tee zx child process outputs to files for debugging when TEST_LOG_DIR is set
try {
  if (globalThis.$ && process.env.TEST_LOG_DIR && process.env.TEST_CAPTURE_LOGS === "1") {
    const origDollar = globalThis.$;
    const baseDir = process.env.TEST_LOG_DIR;
    const target = process.env.BUCK_TEST_TARGET || process.env.TEST_TARGET || "unknown-test";
    const safe = target
      .replace(/^.*?:/, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .slice(0, 200);
    const dir = pathMod2.default.join(baseDir, safe, "children");
    try {
      await fsp.mkdir(dir, { recursive: true });
    } catch {}

    globalThis.$ = function wrappedDollar(...args) {
      const startedAt = Date.now();
      const rand = Math.random().toString(36).slice(2, 8);
      const base = `${startedAt}-${rand}`;
      const outPath = pathMod2.default.join(dir, `${base}.stdout.log`);
      const errPath = pathMod2.default.join(dir, `${base}.stderr.log`);
      const p = origDollar.apply(this, args);
      const writeLogs = async (stdout, stderr) => {
        try {
          if (stdout) await fsp.appendFile(outPath, String(stdout));
        } catch {}
        try {
          if (stderr) await fsp.appendFile(errPath, String(stderr));
        } catch {}
      };
      // best-effort: attach then/catch without altering return value
      try {
        p.then(
          (res) => writeLogs(res?.stdout, res?.stderr),
          (e) => writeLogs(e?.stdout, e?.stderr),
        );
      } catch {}
      return p;
    };
  }
} catch {}
