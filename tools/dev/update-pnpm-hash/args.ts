import { getFlagBool, getFlagStr } from "../../lib/cli.ts";

export type UpdatePnpmHashArgs = {
  lockfile?: string;
  force?: boolean;
};

export function parseUpdatePnpmHashArgs(): UpdatePnpmHashArgs {
  const lockfileRaw = getFlagStr("lockfile", "").trim();
  const lockfile = lockfileRaw.length > 0 ? lockfileRaw : undefined;

  const force = getFlagBool("force-store-rehash") || getFlagBool("force");
  return { lockfile, force };
}
