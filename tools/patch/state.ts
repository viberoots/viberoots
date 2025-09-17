import fs from "fs-extra";
import type { SessionRecord, SessionStore } from "./types";

const STORE_PATH = ".patch-sessions.json";

async function readStore(): Promise<SessionStore> {
  if (!(await fs.pathExists(STORE_PATH))) {
    return { version: 1, sessions: {} };
  }
  const txt = await fs.readFile(STORE_PATH, "utf8");
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
  const tmp = STORE_PATH + ".tmp";
  await fs.outputFile(tmp, JSON.stringify(store, null, 2) + "\n", "utf8");
  await fs.move(tmp, STORE_PATH, { overwrite: true });
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
