import path from "node:path";
import { runNodeWithZx } from "../../lib/node-run.ts";

export async function computeZxTestNodeModulesOut(
  root: string,
  zxInitPath: string,
): Promise<string> {
  const { stdout } = await runNodeWithZx({
    cwd: root,
    script: path.join(root, "build-tools/tools/dev/node-modules-build.ts"),
    args: ["--print-out-paths"],
    zxInitPath,
    stdio: "pipe",
    env: { ...process.env, ZX_TEST_NODE_MODULES_IMPORTER: "." },
  });
  return (
    String(stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop() || ""
  );
}
