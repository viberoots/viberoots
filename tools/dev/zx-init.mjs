import "zx/globals";

const { register } = await import("node:module");
const { pathToFileURL } = await import("node:url");
const src = `export async function resolve(specifier, context, nextResolve) { try { const rel = specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/'); const base = context.parentURL || 'file:///'; if (rel) { const last = new URL(specifier, base).pathname.split('/').pop() || ''; if (!/\\.[a-zA-Z0-9]+$/.test(last)) { const withTs = new URL(specifier + '.ts', base).href; return await nextResolve(withTs, context); } } } catch {} return nextResolve(specifier, context); }`;
const dataUrl = "data:text/javascript," + encodeURIComponent(src);
register(dataUrl, pathToFileURL(process.cwd() + "/"));
