import { extractHash } from "./nix";

export type FixedStoreBuildResult = { ok: boolean; output: string; outPath?: string };

export async function shouldRebuildFixedStore(
  inspect: () => Promise<"realized" | "absent" | "invalid">,
): Promise<boolean> {
  return (await inspect()) === "realized";
}

async function restoreMetadataOrThrow(
  restoreMetadata: () => Promise<void>,
  primary: unknown,
): Promise<void> {
  try {
    await restoreMetadata();
  } catch (rollback) {
    throw new AggregateError(
      [primary, rollback],
      "metadata rollback failed after fixed pnpm store reconciliation failure",
      { cause: primary },
    );
  }
}

export async function reconcileFixedPnpmStore(opts: {
  currentHash: string;
  expectedDerivationName: string;
  rebuild: boolean;
  runBuild: (rebuild: boolean) => Promise<FixedStoreBuildResult>;
  updateHash: (hash: string) => Promise<void>;
  restoreMetadata: () => Promise<void>;
}): Promise<{ hash: string; outPath?: string }> {
  const first = await opts.runBuild(opts.rebuild);
  if (first.ok) return { hash: opts.currentHash, outPath: first.outPath };

  const suggested = extractHash(first.output, opts.expectedDerivationName, opts.currentHash);
  if (!suggested) {
    throw new Error(
      `fixed pnpm store reconciliation failed without one authoritative Nix hash mismatch\n\n${first.output}`,
    );
  }

  let second: FixedStoreBuildResult;
  try {
    await opts.updateHash(suggested);
    second = await opts.runBuild(false);
  } catch (error) {
    await restoreMetadataOrThrow(opts.restoreMetadata, error);
    throw error;
  }
  if (second.ok) return { hash: suggested, outPath: second.outPath };

  const secondSuggested = extractHash(second.output, opts.expectedDerivationName, suggested);
  if (secondSuggested && secondSuggested !== suggested) {
    const primary = new Error(
      `fixed pnpm store was non-deterministic: ${suggested} then ${secondSuggested}`,
    );
    await restoreMetadataOrThrow(opts.restoreMetadata, primary);
    throw new Error(
      `fixed pnpm store was non-deterministic: ${suggested} then ${secondSuggested}; restored prior metadata`,
      { cause: primary },
    );
  }
  const primary = new Error(`fixed pnpm store still failed after hash update\n\n${second.output}`);
  await restoreMetadataOrThrow(opts.restoreMetadata, primary);
  throw new Error(
    `fixed pnpm store still failed after hash update; restored prior metadata\n\n${second.output}`,
    { cause: primary },
  );
}
