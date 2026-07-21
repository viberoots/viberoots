import * as fsp from "node:fs/promises";
import { normalizeTargetLabel } from "../lib/labels";
import { runCommand } from "./run-command";

export async function buck2Present(command: string, env: Record<string, string>): Promise<boolean> {
  return (await runCommand(command, ["--version"], { env, stdio: "ignore" })).exitCode === 0;
}

function parseGraphNodes(text: string): any[] {
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray((data as any).nodes)) return (data as any).nodes;
  return [];
}

export function graphContainsTarget(text: string, target: string): boolean {
  const wanted = String(target || "").trim();
  if (!wanted) return true;
  const normalized = normalizeTargetLabel(wanted);
  return parseGraphNodes(text).some(
    (node: any) => typeof node?.name === "string" && normalizeTargetLabel(node.name) === normalized,
  );
}

export async function isJsonFile(path: string, allowEmptyGraph: boolean): Promise<boolean> {
  try {
    const text = String((await fsp.readFile(path, "utf8")) || "").trim();
    if (!text || (!allowEmptyGraph && text === "[]")) return false;
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
