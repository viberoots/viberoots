import { getArgvTokens } from "../../lib/cli.ts";

export type VerifyConsole = "auto" | "super" | "simple";

export type VerifyArgs = {
  coverage: boolean;
  console: VerifyConsole;
  targets: string[];
};

export function parseVerifyArgs(): VerifyArgs {
  const tokens = getArgvTokens();

  let coverage = false;
  let console: VerifyConsole = "auto";
  const passthrough: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] || "";
    if (t === "--") {
      passthrough.push(...tokens.slice(i + 1));
      break;
    }
    if (t === "--coverage") {
      coverage = true;
      continue;
    }
    if (t.startsWith("--console=")) {
      const v = t.slice("--console=".length).trim();
      if (v === "auto" || v === "super" || v === "simple") console = v;
      continue;
    }
    if (t === "--console") {
      const v = String(tokens[i + 1] || "").trim();
      if (v === "auto" || v === "super" || v === "simple") console = v;
      i++;
      continue;
    }
    // Treat all other flags as verify-internal; only targets should be passed through.
    if (t.startsWith("--")) continue;
    passthrough.push(t);
  }

  return { coverage, console, targets: passthrough.length > 0 ? passthrough : ["//..."] };
}
