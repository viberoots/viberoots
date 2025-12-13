import path from "node:path";
import "zx/globals";

async function resolveRootNodeModulesOut(root: string): Promise<string> {
  try {
    const { stdout } = await $({
      stdio: "pipe",
      cwd: root,
    })`nix eval --raw .#node-modules.default.outPath --accept-flake-config`;
    const out = String(stdout || "").trim();
    if (out) return out;
  } catch {}
  try {
    const { stdout } = await $({
      stdio: "pipe",
      cwd: root,
    })`nix build .#node-modules.default --no-link --no-write-lock-file --accept-flake-config --print-out-paths`;
    return (
      String(stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop() || ""
    );
  } catch {}
  return "";
}

export async function runStartupCheck(root: string): Promise<void> {
  const rootNmOut = await resolveRootNodeModulesOut(root);
  const envStartup = {
    ...process.env,
    ...(rootNmOut
      ? {
          NODE_PATH: [path.join(rootNmOut, "node_modules"), process.env.NODE_PATH || ""]
            .filter(Boolean)
            .join(process.platform === "win32" ? ";" : ":"),
        }
      : {}),
  } as any;
  await $({ stdio: "inherit", cwd: root, env: envStartup })`tools/dev/startup-check.ts`;
}
