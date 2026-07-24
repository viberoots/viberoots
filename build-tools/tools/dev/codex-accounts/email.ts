// Email authority for account reports and the default/legacy conflict warning.
import { getFlagStr } from "../../lib/cli";
import { inspectAuthentication } from "./auth-state";

export async function accountEmail(root: string): Promise<string | null> {
  const auth = await inspectAuthentication(root);
  return auth.usable ? auth.email : null;
}

export async function runEmail(): Promise<number> {
  try {
    const root = getFlagStr("root", "").trim();
    if (root.length === 0) return 0;
    const email = await accountEmail(root);
    if (email) process.stdout.write(email);
    return 0;
  } catch {
    return 0;
  }
}
