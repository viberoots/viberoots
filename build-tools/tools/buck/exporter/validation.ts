#!/usr/bin/env zx-wrapper
import type { Adapter, Node } from "./types.ts";

export type ValidationMode = "warn" | "error";

export async function collectFindings(
  adapters: Adapter[],
  nodes: Node[],
  verbose: boolean,
): Promise<{ findings: string[]; nodeValidateMs: number }> {
  const findings: string[] = [];
  let nodeValidateMs = 0;
  for (const a of adapters) {
    if (typeof a.validate === "function") {
      try {
        let t0: number | null = null;
        if (verbose && a.name === "node") t0 = Date.now();
        const res = await a.validate(nodes);
        if (t0 !== null) nodeValidateMs += Date.now() - t0;
        if (Array.isArray(res)) findings.push(...res.filter(Boolean));
      } catch (e: any) {
        // Adapters should not throw; convert to a finding to avoid losing context
        findings.push(String(e?.message || e));
      }
    }
  }
  if (verbose) {
    try {
      console.log(`[exporter][timing] node.validate: ${nodeValidateMs}ms`);
    } catch {}
  }
  return { findings, nodeValidateMs };
}

export function determineMode(initial: ValidationMode): { mode: ValidationMode; ci: boolean } {
  const ci = String(process.env.CI || "").toLowerCase() === "true";
  const mode: ValidationMode = ci ? "error" : initial;
  return { mode, ci };
}

export function logValidationMode(
  mode: ValidationMode,
  ci: boolean,
  cliValidation: string,
  envValidation: string,
  adapters: Adapter[],
  findingsCount: number,
  verbose: boolean,
): void {
  if (!verbose) return;
  try {
    console.log(
      `[exporter][mode] validation=${mode} (ci=${ci}, cli=${cliValidation || "-"}, env=${
        envValidation || "-"
      })`,
    );
    console.log(`[exporter][adapters] present=${adapters.map((a) => a.name).join(",")}`);
    console.log(`[exporter][findings] count=${findingsCount}`);
  } catch {}
}

export function emitFindings(findings: string[], mode: ValidationMode): void {
  if (!findings.length) return;
  const hdr = `[exporter] validation ${mode === "warn" ? "warnings" : "errors"} (${findings.length}):`;
  const body = findings.map((m) => `- ${m}`).join("\n\n");
  if (mode === "warn") {
    console.warn(`${hdr}\n\n${body}`);
  } else {
    console.error(`${hdr}\n\n${body}`);
    process.exit(2);
  }
}
