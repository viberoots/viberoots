import * as fsp from "node:fs/promises";
import { graphContainsTarget } from "../patch/glue-graph";

export type GeneratedGraphStatus = "ready" | "missing" | "empty" | "invalid" | "target-missing";

export async function inspectGeneratedGraph(opts: {
  graphPath: string;
  target?: string;
}): Promise<{ status: GeneratedGraphStatus; graphPath: string; target: string }> {
  const target = String(opts.target || "").trim();
  let text: string;
  try {
    text = await fsp.readFile(opts.graphPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing", graphPath: opts.graphPath, target };
    }
    throw error;
  }
  const trimmed = text.trim();
  if (!trimmed || trimmed === "[]") {
    return { status: "empty", graphPath: opts.graphPath, target };
  }
  try {
    JSON.parse(trimmed);
  } catch {
    return { status: "invalid", graphPath: opts.graphPath, target };
  }
  if (target && !graphContainsTarget(trimmed, target)) {
    return { status: "target-missing", graphPath: opts.graphPath, target };
  }
  return { status: "ready", graphPath: opts.graphPath, target };
}

export async function requireGeneratedGraph(opts: {
  graphPath: string;
  target?: string;
}): Promise<void> {
  const result = await inspectGeneratedGraph(opts);
  if (result.status === "ready") return;
  const targetDetail = result.target ? ` for ${result.target}` : "";
  throw new Error(
    [
      `generated Buck graph is ${result.status}${targetDetail}: ${result.graphPath}`,
      "no generated metadata was modified",
      "repair: run u",
    ].join("\n"),
  );
}
