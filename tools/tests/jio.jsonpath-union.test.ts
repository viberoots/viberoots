#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./lib/test-helpers";
import { defineToolSpec } from "../jio/spec";

describe("jio JSONPath property-name unions", () => {
  test("gh repo clone style OWNER/REPO via union + CSV", async () => {
    await runInTemp("jio-union-csv", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const spec = defineToolSpec({
        tool: { name: "clone" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            repo: {
              path: "$['owner','repo']",
              type: "array",
              position: 2,
              collectionStyle: "csv",
              csvSeparator: "/",
            },
          },
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      const p = path.join(tmp, "clone.tool.json");
      await fsp.writeFile(p, JSON.stringify(spec, null, 2), "utf8");
      const inv = path.join(tmp, "inv.json");
      await fsp.writeFile(inv, JSON.stringify({ owner: "kubernetes", repo: "kubectl" }), "utf8");
      const out = await $({ stdio: "pipe" })`jio io.example.clone --in ${inv} --dry-run`;
      const plan = JSON.parse(String(out.stdout));
      const argv: string[] = plan.argv;
      if (!(argv.includes("-lc") && argv.includes("kubernetes/kubectl"))) {
        console.error("union + csv not reflected in argv:", argv);
        process.exit(2);
      }
    });
  });

  test("repeatFlag over union of properties", async () => {
    await runInTemp("jio-union-flags", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const spec = defineToolSpec({
        tool: { name: "flags" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            targets: {
              path: "$['owner','repo']",
              type: "array",
              flag: true,
              flagName: "--target",
              collectionStyle: "repeatFlag",
            },
          },
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      const p = path.join(tmp, "flags.tool.json");
      await fsp.writeFile(p, JSON.stringify(spec, null, 2), "utf8");
      const inv = path.join(tmp, "inv.json");
      await fsp.writeFile(inv, JSON.stringify({ owner: "cli", repo: "cli" }), "utf8");
      const out = await $({ stdio: "pipe" })`jio io.example.flags --in ${inv} --dry-run`;
      const plan = JSON.parse(String(out.stdout));
      const argv: string[] = plan.argv;
      if (
        !(argv.includes("--target=cli") && argv.filter((x) => x === "--target=cli").length === 2)
      ) {
        console.error("repeatFlag over union not reflected correctly:", argv);
        process.exit(2);
      }
    });
  });
});
