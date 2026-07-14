export async function withAsyncCleanup<T>(
  operation: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  let result: T;
  try {
    result = await operation();
  } catch (primaryError) {
    await rethrowAfterAsyncCleanup(primaryError, cleanup);
  }
  await cleanup();
  return result;
}

export async function rethrowAfterAsyncCleanup(
  primaryError: unknown,
  cleanup: () => Promise<void>,
): Promise<never> {
  try {
    await cleanup();
  } catch (cleanupError) {
    if (primaryError instanceof Error) {
      primaryError.cause =
        primaryError.cause === undefined
          ? cleanupError
          : new AggregateError(
              [primaryError.cause, cleanupError],
              "operation and cleanup both failed",
            );
    } else {
      throw new AggregateError([primaryError, cleanupError], "operation and cleanup both failed", {
        cause: primaryError,
      });
    }
  }
  throw primaryError;
}

export async function runAsyncCleanupSteps(steps: Array<() => Promise<void>>): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "multiple cleanup steps failed");
}
