import * as fsp from "node:fs/promises";
import path from "node:path";
import { shSingleQuote } from "./shell-quote";

type RemoveTreeDeps = {
  remove?: (target: string) => Promise<void>;
  makeWritable?: (target: string) => Promise<void>;
};

export async function removeTreeWithWritableFallback(
  target: string,
  $: any,
  deps: RemoveTreeDeps = {},
): Promise<void> {
  const remove =
    deps.remove || (async (value) => await fsp.rm(value, { recursive: true, force: true }));
  const makeWritable =
    deps.makeWritable ||
    (async (value) => {
      const q = shSingleQuote(value);
      await $({
        stdio: "ignore",
        cwd: process.cwd(),
        reject: false,
        nothrow: true,
      })`bash --noprofile --norc -c ${`chmod -R u+w ${q} >/dev/null 2>&1 || true`}`;
    });

  try {
    await remove(target);
    return;
  } catch {
    await makeWritable(target).catch(() => {});
    await remove(target);
  }
}
