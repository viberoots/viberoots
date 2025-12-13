import * as fsp from "node:fs/promises";
import path from "node:path";
import type { Capabilities, LangEntry, Manifest } from "./types";

export async function readManifest(manifestRelPath = "tools/nix/langs.json"): Promise<{
  enabled: Set<string>;
  caps: Map<string, Capabilities>;
  langs: Map<string, LangEntry>;
}> {
  const manifestPath = path.resolve(manifestRelPath);
  const enabled = new Set<string>();
  const caps = new Map<string, Capabilities>();
  const langs = new Map<string, LangEntry>();

  try {
    const txt = await fsp.readFile(manifestPath, "utf8");
    const raw = JSON.parse(txt) as Manifest;

    if (Array.isArray(raw)) {
      for (const l of raw) {
        if (l && typeof (l as any).id === "string") {
          const id = String((l as any).id);
          langs.set(id, l as any);
          if ((l as any).capabilities) caps.set(id, ((l as any).capabilities || {}) as any);
        }
      }
      return { enabled, caps, langs };
    }

    if (raw && typeof raw === "object") {
      for (const id of raw.enabled || []) enabled.add(String(id));
      for (const l of raw.languages || []) {
        if (l && typeof (l as any).id === "string") {
          const id = String((l as any).id);
          langs.set(id, l as any);
          if ((l as any).capabilities) caps.set(id, ((l as any).capabilities || {}) as any);
        }
      }
    }
  } catch {
    return { enabled, caps, langs };
  }

  return { enabled, caps, langs };
}
