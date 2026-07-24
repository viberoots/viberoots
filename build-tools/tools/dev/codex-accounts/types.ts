export type AuthMode = "chatgpt" | "api-key" | null;
export type AuthStatus = "usable" | "missing" | "empty" | "corrupt" | "unsupported";

export type AuthInspection = {
  mode: AuthMode;
  status: AuthStatus;
  usable: boolean;
  email: string | null;
  expired: boolean | null;
};

export type AccountSource = "cli" | "codex-home" | "env" | "default" | "legacy" | "none";

export type Resolution = {
  source: AccountSource;
  accountName: string | null;
  codexHome: string | null;
  warnings: string[];
};

export type ParsedAccountArgs = {
  accountName: string | null;
  accountInit: boolean;
  listFormat: "text" | "json" | null;
  removeName: string | null;
  removeYes: boolean;
  strippedArgs: string[];
  reexecPrefix: string[];
  command: string | null;
};

export type WrapperPlan =
  | {
      action: "delegate";
      codexHome: string | null;
      args: string[];
      reexecPrefix: string[];
    }
  | { action: "reexec"; args: string[] }
  | { action: "exit"; exitCode: number };
