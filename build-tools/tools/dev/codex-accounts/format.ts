// Renderers for the codex-accounts list command.
import type { AccountInfo } from "./fs-inspect";

export type Row = {
  name: string;
  auth: string; // display label
  email: string; // display label
  isDefault: boolean;
};

export type JsonRow = {
  name: string;
  auth: "chatgpt" | "api-key" | null;
  email: string | null;
  default: boolean;
  expired: boolean | null;
};

export function toRow(info: AccountInfo, isDefault: boolean): Row {
  let authLabel: string;
  let emailLabel: string;
  if (info.auth === "chatgpt") {
    authLabel = "chatgpt";
    if (info.email && info.email.length > 0) {
      emailLabel = info.expired ? `${info.email} (expired)` : info.email;
    } else {
      emailLabel = "not logged in";
    }
  } else if (info.auth === "api-key") {
    authLabel = "api-key";
    emailLabel = "(api key)";
  } else {
    authLabel = "(none)";
    emailLabel = "not logged in";
  }
  return { name: info.name, auth: authLabel, email: emailLabel, isDefault };
}

export function toJsonRow(info: AccountInfo, isDefault: boolean): JsonRow {
  return {
    name: info.name,
    auth: info.auth,
    email: info.email,
    default: isDefault,
    expired: info.expired,
  };
}

export function renderText(rows: Row[]): string {
  const header = { name: "NAME", auth: "AUTH", email: "EMAIL", def: "DEFAULT" };
  const data = rows.map((r) => ({
    name: r.name,
    auth: r.auth,
    email: r.email,
    def: r.isDefault ? "*" : "",
  }));
  const all = [header, ...data];
  const nameW = Math.max(...all.map((r) => r.name.length));
  const authW = Math.max(...all.map((r) => r.auth.length));
  const emailW = Math.max(...all.map((r) => r.email.length));
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const lines: string[] = [];
  for (const r of all) {
    const cells = [pad(r.name, nameW), pad(r.auth, authW), pad(r.email, emailW), r.def];
    lines.push(cells.join("  ").replace(/\s+$/g, ""));
  }
  return lines.join("\n") + "\n";
}

export function renderJson(rows: JsonRow[]): string {
  return JSON.stringify(rows, null, 2) + "\n";
}
