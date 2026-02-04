import * as fsp from "node:fs/promises";
import path from "node:path";

export async function rewriteCoverageUrls(tmpRoot: string) {
  try {
    const repoRoot = process.cwd();
    const covDir = path.join(repoRoot, "coverage", "raw");
    const files = await fsp.readdir(covDir).catch(() => [] as string[]);
    const fromPrefix1 = "file://" + tmpRoot;
    const fromPrefix2 = tmpRoot.startsWith("/") ? "file:///" + tmpRoot.slice(1) : fromPrefix1;
    const privateTmp = tmpRoot.startsWith("/var/") ? "/private" + tmpRoot : tmpRoot;
    const fromPrefix3 = "file://" + privateTmp;
    const fromPrefix4 = privateTmp.startsWith("/") ? "file:///" + privateTmp.slice(1) : fromPrefix3;
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const p = path.join(covDir, f);
      const txt = await fsp.readFile(p, "utf8").catch(() => "");
      if (!txt || (!txt.includes(fromPrefix1) && !txt.includes(fromPrefix2))) continue;
      let json: any;
      try {
        json = JSON.parse(txt);
      } catch {
        continue;
      }
      const toPrefix = "file://" + repoRoot;
      const rewriter = (u: string) =>
        u.startsWith(fromPrefix1)
          ? toPrefix + u.slice(fromPrefix1.length)
          : u.startsWith(fromPrefix2)
            ? toPrefix + u.slice(fromPrefix2.length)
            : u.startsWith(fromPrefix3)
              ? toPrefix + u.slice(fromPrefix3.length)
              : u.startsWith(fromPrefix4)
                ? toPrefix + u.slice(fromPrefix4.length)
                : u;
      if (Array.isArray(json.result)) {
        for (const e of json.result) {
          if (e && typeof e.url === "string") e.url = rewriter(e.url);
        }
      }
      if (json["source-map-cache"] && typeof json["source-map-cache"] === "object") {
        const smc = json["source-map-cache"] as Record<string, any>;
        const next: Record<string, any> = {};
        for (const [k, v] of Object.entries(smc)) {
          const nk = rewriter(k);
          next[nk] = v;
        }
        json["source-map-cache"] = next;
      }
      await fsp.writeFile(p, JSON.stringify(json), "utf8");
    }
  } catch {}
}
