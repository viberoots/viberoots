import * as fsp from "node:fs/promises";
import path from "node:path";
import type { SessionRecord, SessionStore } from "./types";

function storePath(): string {
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const repoRoot =
      (process.env.WORKSPACE_ROOT && path.resolve(process.env.WORKSPACE_ROOT)) ||
      path.resolve(here, "..", "..");
    return path.join(repoRoot, ".patch-sessions.json");
  } catch {
    return ".patch-sessions.json";
  }
}

async function readStore(): Promise<SessionStore> {
  const p = storePath();
  try {
    await fsp.access(p);
  } catch {
    return { version: 1, sessions: {} };
  }
  const txt = await fsp.readFile(p, "utf8");
  try {
    const obj = JSON.parse(txt) as SessionStore;
    if (!obj || typeof obj !== "object" || typeof obj.version !== "number") {
      throw new Error("invalid session store");
    }
    obj.sessions ||= {} as any;
    return obj;
  } catch {
    throw new Error("failed to parse .patch-sessions.json");
  }
}

async function writeStore(store: SessionStore): Promise<void> {
  const p = storePath();
  const tmp = p + ".tmp";
  await fsp.mkdir(path.dirname(p), { recursive: true }).catch(() => {});
  await fsp.writeFile(tmp, JSON.stringify(store, null, 2) + "\n", "utf8");
  try {
    // Best-effort atomic replace
    await fsp.rename(tmp, p);
  } catch {
    try {
      await fsp.rm(p, { force: true });
    } catch {}
    await fsp.rename(tmp, p);
  }
}

export async function getSession(lang: string, moduleKey: string): Promise<SessionRecord | null> {
  const st = await readStore();
  const byLang = st.sessions[lang] || {};
  return byLang[moduleKey] || null;
}

export async function setSession(
  lang: string,
  moduleKey: string,
  rec: SessionRecord,
): Promise<void> {
  const st = await readStore();
  st.sessions[lang] ||= {} as any;
  st.sessions[lang]![moduleKey] = rec;
  await writeStore(st);
}

export async function deleteSession(lang: string, moduleKey: string): Promise<void> {
  const st = await readStore();
  if (st.sessions[lang]) {
    delete st.sessions[lang]![moduleKey];
  }
  await writeStore(st);
}

export async function findSessionBy(
  lang: string,
  predicate: (moduleKey: string, rec: SessionRecord) => boolean,
): Promise<{ moduleKey: string; rec: SessionRecord } | null> {
  const st = await readStore();
  const byLang = st.sessions[lang] || {};
  for (const [k, rec] of Object.entries(byLang)) {
    if (predicate(k, rec as SessionRecord)) return { moduleKey: k, rec: rec as SessionRecord };
  }
  return null;
}
