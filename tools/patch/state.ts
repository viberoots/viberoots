import * as fsp from "node:fs/promises";
import path from "node:path";
import type { SessionRecord, SessionStore } from "./types";

function debugEnabled(): boolean {
  try {
    return String(process.env.PATCH_CPP_DEBUG || "").trim() === "1";
  } catch {
    return false;
  }
}

function dbg(...args: any[]) {
  if (!debugEnabled()) return;
  try {
    console.error("[patch-state][debug]", ...args);
  } catch {}
}

function storePath(): string {
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const repoRoot =
      (process.env.WORKSPACE_ROOT && path.resolve(process.env.WORKSPACE_ROOT)) ||
      path.resolve(here, "..", "..");
    const p = path.join(repoRoot, ".patch-sessions.json");
    dbg("storePath", { repoRoot, p });
    return p;
  } catch {
    return ".patch-sessions.json";
  }
}

async function readStore(): Promise<SessionStore> {
  const p = storePath();
  try {
    await fsp.access(p);
  } catch {
    dbg("readStore: new");
    return { version: 1, sessions: {} };
  }
  const txt = await fsp.readFile(p, "utf8");
  try {
    const obj = JSON.parse(txt) as SessionStore;
    if (!obj || typeof obj !== "object" || typeof obj.version !== "number") {
      throw new Error("invalid session store");
    }
    obj.sessions ||= {} as any;
    dbg("readStore: ok", { keys: Object.keys(obj.sessions || {}) });
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
    dbg("writeStore: renamed", { p });
  } catch {
    try {
      await fsp.rm(p, { force: true });
    } catch {}
    await fsp.rename(tmp, p);
    dbg("writeStore: replaced", { p });
  }
}

export async function getSession(lang: string, moduleKey: string): Promise<SessionRecord | null> {
  const st = await readStore();
  const byLang = st.sessions[lang] || {};
  const out = (byLang as any)[moduleKey] || null;
  dbg("getSession", { lang, moduleKey, hit: !!out });
  return out;
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
  dbg("setSession", { lang, moduleKey });
}

export async function deleteSession(lang: string, moduleKey: string): Promise<void> {
  const st = await readStore();
  if (st.sessions[lang]) {
    delete st.sessions[lang]![moduleKey];
  }
  await writeStore(st);
  dbg("deleteSession", { lang, moduleKey });
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

export async function listSessions(
  lang: string,
): Promise<Array<{ moduleKey: string; rec: SessionRecord }>> {
  const st = await readStore();
  const byLang = st.sessions[lang] || {};
  const out: Array<{ moduleKey: string; rec: SessionRecord }> = [];
  for (const [k, rec] of Object.entries(byLang)) {
    out.push({ moduleKey: k, rec: rec as SessionRecord });
  }
  dbg("listSessions", { lang, count: out.length });
  return out;
}
