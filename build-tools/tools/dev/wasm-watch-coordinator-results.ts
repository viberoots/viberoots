import * as fsp from "node:fs/promises";
import path from "node:path";
import type { CoordinatorResult } from "./wasm-watch-coordinator-types";

export function coordinatorResultPath(resultsDir: string, taskKey: string): string {
  if (!/^wasm-[a-f0-9]{20}$/.test(taskKey)) throw new Error(`invalid wasm task key: ${taskKey}`);
  return path.join(resultsDir, `${taskKey}.json`);
}

export async function readCoordinatorResult(
  resultsDir: string,
  taskKey: string,
): Promise<CoordinatorResult | null> {
  try {
    const parsed = JSON.parse(
      await fsp.readFile(coordinatorResultPath(resultsDir, taskKey), "utf8"),
    ) as CoordinatorResult;
    if (parsed.schemaVersion !== 1 || parsed.taskKey !== taskKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeCoordinatorResult(
  resultsDir: string,
  result: CoordinatorResult,
): Promise<void> {
  await fsp.mkdir(resultsDir, { recursive: true });
  const target = coordinatorResultPath(resultsDir, result.taskKey);
  const temp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(temp, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await fsp.rename(temp, target);
}

export async function outputIdentities(
  outputs: string[],
): Promise<Array<{ path: string; size: number }>> {
  return await Promise.all(
    outputs.map(async (output) => ({ path: output, size: (await fsp.stat(output)).size })),
  );
}
