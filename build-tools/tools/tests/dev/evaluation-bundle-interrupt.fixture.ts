#!/usr/bin/env zx-wrapper
import { spawn } from "node:child_process";
import { materializeEvaluationBundle } from "../../dev/evaluation-bundle";
import { resolveToolPathSync } from "../../lib/tool-paths";

const source = String(process.argv[2] || "");
const mode = String(process.argv[3] || "sigterm");

try {
  await materializeEvaluationBundle(
    { stagedSource: source, attr: "graph-generator", classification: "hermetic" },
    {
      register: async (_bundleRoot, recordProcessGroup) => {
        if (mode === "sigkill") {
          const child = spawn(
            resolveToolPathSync("bash"),
            ["--noprofile", "--norc", "-c", "trap '' TERM; while :; do sleep 1; done"],
            { detached: true, stdio: "ignore" },
          );
          const processGroupId = child.pid || 0;
          recordProcessGroup(processGroupId);
          process.stdout.write(`registration-ready:${processGroupId}\n`);
          await new Promise(() => {});
        }
        process.stdout.write("registration-ready\n");
        await new Promise((resolve) => setTimeout(resolve, 200));
        return "/nix/store/00000000000000000000000000000000-viberoots-evaluation-bundle";
      },
    },
  );
  process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 0;
}
