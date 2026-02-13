export type Language = "go" | string;

export type SessionRecord = {
  importPath: string;
  version: string;
  originPath: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionStore = {
  version: number;
  sessions: Record<string, Record<string, SessionRecord>>; // sessions[lang][moduleKey]
};

export interface LanguageHandler {
  start(args: string[]): Promise<void>;
  apply(args: string[]): Promise<void>;
  reset(args: string[]): Promise<void>;
  session(args: string[]): Promise<void>;
  remove?(args: string[]): Promise<void>;
  syncRequired?(args: string[]): Promise<void>;
}

export type ResolveResult = { importPath: string; version: string; originPath: string };
