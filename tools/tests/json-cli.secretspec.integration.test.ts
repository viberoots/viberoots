#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../json-cli/spec";
import { runInTemp } from "./lib/test-helpers";

describe("json-cli auto-wrap with SecretSpec when secretspec.toml exists", () => {
  test("dotenv provider injects FAKE secrets without calling secretspec run explicitly", async () => {
    await runInTemp("json-cli-secrets-auto", async (tmp, $) => {
      // Make a very obviously fake secret value
      const fakeEnv = path.join(tmp, ".fake-secrets.env");
      await fsp.writeFile(fakeEnv, "API_TOKEN=FAKE_SECRET_TOKEN\n", "utf8");

      // Minimal valid secretspec.toml (presence triggers auto-wrap; include required revision)
      await fsp.writeFile(
        path.join(tmp, "secretspec.toml"),
        '[project]\nname="demo"\nrevision="1.0"\n\n[profiles.default]\nAPI_TOKEN = {}\n',
        "utf8",
      );

      // .json-cli with defaultPackage
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
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

      // Run json-cli normally, relying on auto-wrap. Provide provider via env.
      const out = await $({
        stdio: "pipe",
        env: {
          ...process.env,
          JSON_CLI_SECRETS_PROFILE: "default",
          JSON_CLI_SECRETS_PROVIDER: `dotenv:${fakeEnv}`,
        },
      })`json-cli io.example.tok`;
      const line = String(out.stdout).trim();
      const got = line ? JSON.parse(line) : "";
      if (got !== "FAKE_SECRET_TOKEN") {
        console.error("secret not injected via auto-wrap:", line);
        process.exit(2);
      }

      // Opt-out should remove secret
      const out2 = await $({
        stdio: "pipe",
        env: {
          ...process.env,
          JSON_CLI_SECRETS_DISABLE: "1",
          JSON_CLI_SECRETS_PROFILE: "default",
          JSON_CLI_SECRETS_PROVIDER: `dotenv:${fakeEnv}`,
        },
      })`json-cli io.example.tok`;
      const line2 = String(out2.stdout).trim();
      const got2 = line2 ? JSON.parse(line2) : "";
      if (got2 === "FAKE_SECRET_TOKEN") {
        console.error("expected opt-out to disable injection");
        process.exit(2);
      }
    });
  });
});
