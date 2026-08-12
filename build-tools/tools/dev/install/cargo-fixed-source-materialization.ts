import type { FixedSourceEntry } from "./cargo-fixed-sources";

export type DeferredFixedSourceMaterialization = {
  lookup?: (
    key: string,
    entry: FixedSourceEntry,
  ) => Promise<{
    storePath: string;
    narHash: string;
  } | null>;
  add: (
    key: string,
    entry: FixedSourceEntry,
  ) => Promise<{
    storePath: string;
  }>;
  hash: (storePaths: string[]) => Promise<string[]>;
  store?: (
    key: string,
    entry: FixedSourceEntry,
    value: {
      storePath: string;
      narHash: string;
    },
  ) => Promise<void>;
};

const fixedSourceMaterializationConcurrency = 4;

export async function forEachFixedSourceMaterialization<T>(
  values: readonly T[],
  fn: (value: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(fixedSourceMaterializationConcurrency, values.length) },
      async () => {
        while (next < values.length) {
          const index = next++;
          await fn(values[index]!);
        }
      },
    ),
  );
}
