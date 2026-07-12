import { getFlagBool, getFlagStr } from "../../lib/cli";

export type UpdatePnpmHashArgs = {
  lockfile?: string;
  force?: boolean;
  readOnly?: boolean;
};

export function parseUpdatePnpmHashArgs(): UpdatePnpmHashArgs {
  const lockfileRaw = getFlagStr("lockfile", "").trim();
  const lockfile = lockfileRaw.length > 0 ? lockfileRaw : undefined;

  const force = getFlagBool("force-store-rehash") || getFlagBool("force");
  const readOnly = getFlagBool("read-only") || getFlagBool("materialize-only");
  return { lockfile, force, readOnly };
}
