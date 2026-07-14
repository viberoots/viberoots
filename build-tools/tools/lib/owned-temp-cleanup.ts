import * as fsp from "node:fs/promises";

export type CleanupStep = () => Promise<void>;

export async function runOwnedTempCleanup(steps: CleanupStep[]): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, "multiple owned temp cleanup steps failed");
}

export async function removeOwnedTempTree(
  target: string,
  remove: (target: string) => Promise<void> = async (value) =>
    await fsp.rm(value, { recursive: true, force: true }),
): Promise<void> {
  await remove(target);
}

export async function rethrowAfterOwnedTempCleanup(
  primaryError: unknown,
  steps: CleanupStep[],
): Promise<never> {
  try {
    await runOwnedTempCleanup(steps);
  } catch (cleanupError) {
    if (primaryError instanceof Error) {
      primaryError.cause =
        primaryError.cause === undefined
          ? cleanupError
          : new AggregateError(
              [primaryError.cause, cleanupError],
              "operation and owned temp cleanup both failed",
            );
    } else {
      throw new AggregateError(
        [primaryError, cleanupError],
        "operation and owned temp cleanup both failed",
        { cause: primaryError },
      );
    }
  }
  throw primaryError;
}

export async function withOwnedTempCleanup<T>(
  operation: () => Promise<T>,
  cleanup: CleanupStep,
): Promise<T> {
  let result: T;
  try {
    result = await operation();
  } catch (primaryError) {
    await rethrowAfterOwnedTempCleanup(primaryError, [cleanup]);
  }
  await cleanup();
  return result;
}
