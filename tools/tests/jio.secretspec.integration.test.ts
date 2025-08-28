#!/usr/bin/env zx-wrapper
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

async function execJsonCli(
  args: string[],
  env: Record<string, string>,
  cwd?: string,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const mergedEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") mergedEnv[k] = v;
    }
    for (const [k, v] of Object.entries(env)) mergedEnv[k] = v;
    const proc = spawn("jio", args, {
      stdio: ["ignore", "pipe", "inherit"],
      env: mergedEnv,
      cwd,
    });
    let out = "";
    proc.stdout.on("data", (buf) => {
      out += Buffer.from(buf).toString("utf8");
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`jio exited with code ${code}`));
    });
  });
}

describe("jio auto-wrap with SecretSpec when secretspec.toml exists", () => {
  test(
    "dotenv provider injects FAKE secrets without calling secretspec run explicitly",
    { timeout: 120_000 },
    async () => {
      process.env.JIO_SKIP_DIRENV = "1";
      await runInTemp("jio-secrets-auto", async (tmp, $) => {
        // Make a very obviously fake secret value
        const fakeEnv = path.join(tmp, ".fake-secrets.env");
        await fsp.writeFile(fakeEnv, "API_TOKEN=FAKE_SECRET_TOKEN\n", "utf8");

        // Minimal valid secretspec.toml (presence triggers auto-wrap; include required revision)
        await fsp.writeFile(
          path.join(tmp, "secretspec.toml"),
          '[project]\nname="demo"\nrevision="1.0"\n\n[profiles.default]\nAPI_TOKEN = {}\n',
          "utf8",
        );

        // .jio with defaultPackage
        await fsp.writeFile(
          path.join(tmp, ".jio"),
          JSON.stringify({ defaultPackage: "io.example" }),
          "utf8",
        );

        // Tool prints the token (use POSIX shell to avoid zx-wrapper dependency in secretspec env)
        const toolScript = path.join(tmp, "tools", "print-token.sh");
        await fsp.mkdir(path.dirname(toolScript), { recursive: true });
        await fsp.writeFile(
          toolScript,
          '#!/usr/bin/env bash\nset -euo pipefail\nprintf "%s\\n" "${API_TOKEN:-NO_TOKEN}"\n',
          "utf8",
        );
        await $`chmod +x ${toolScript}`;

        // Tool spec
        const spec = defineToolSpec({
          tool: { name: "tok" },
          command: {
            package: "io.example",
            exec: toolScript,
            parameters: {},
            stdoutTransform: { shell: "jq -R -c .", format: "ndjson" },
          },
        });
        await fsp.writeFile(path.join(tmp, "tok.tool.json"), JSON.stringify(spec, null, 2), "utf8");

        // Run jio normally, relying on auto-wrap. Provide provider via env.
        const out = await execJsonCli(
          ["io.example.tok"],
          {
            JIO_SKIP_DIRENV: "1",
            JIO_SECRETS_PROFILE: "default",
            JIO_SECRETS_PROVIDER: `dotenv:${fakeEnv}`,
          },
          tmp,
        );
        const line = String(out).trim();
        const got = line ? JSON.parse(line) : "";
        if (got !== "FAKE_SECRET_TOKEN") {
          console.error("secret not injected via auto-wrap:", line);
          process.exit(2);
        }

        // Opt-out should remove secret
        const out2 = await execJsonCli(
          ["io.example.tok"],
          {
            JIO_SKIP_DIRENV: "1",
            JIO_SECRETS_DISABLE: "1",
            JIO_SECRETS_PROFILE: "default",
            JIO_SECRETS_PROVIDER: `dotenv:${fakeEnv}`,
          },
          tmp,
        );
        const line2 = String(out2).trim();
        const got2 = line2 ? JSON.parse(line2) : "";
        if (got2 === "FAKE_SECRET_TOKEN") {
          console.error("expected opt-out to disable injection");
          process.exit(2);
        }
      });
    },
  );
});
