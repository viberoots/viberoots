import path from "node:path";

import * as fsp from "node:fs/promises";

import { exists } from "../fs.ts";
import { runScafCommand } from "../command-runner.ts";

export async function runPostSteps(dest: string) {
  const goMod = path.join(dest, "go.mod");
  if (await exists(goMod)) {
    try {
      await runScafCommand("bash", [
        "-c",
        `cd ${JSON.stringify(dest)} && go fmt ./... || true && go mod tidy || true`,
      ]);
    } catch {}
  }
}
