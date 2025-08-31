#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio env defaults and glob passEnv", () => {
  test("keeps LANG/LC_ALL/SSL_CERT_FILE/GIT_SSH_COMMAND/SSH_AUTH_SOCK by default and supports AWS_* glob", async () => {
    await runInTemp("jio-env-defaults-glob", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      const toolPath = path.join(tmp, "tools", "printenv.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
console.log(JSON.stringify({
  LANG: process.env.LANG || "",
  LC_ALL: process.env.LC_ALL || "",
  SSL_CERT_FILE: process.env.SSL_CERT_FILE || "",
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || "",
  SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK || "",
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || "",
}));
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const specPath = path.join(tmp, "penv.tool.json");
      const spec = defineToolSpec({
        tool: { name: "penv", outputSchema: { type: "object" } },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "json" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      const env = {
        ...process.env,
        JIO_SKIP_DIRENV: "1",
        LANG: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8",
        SSL_CERT_FILE: "/etc/ssl/cert.pem",
        GIT_SSH_COMMAND: "ssh -i ~/.ssh/id_rsa",
        SSH_AUTH_SOCK: "/tmp/ssh.sock",
        AWS_SECRET_ACCESS_KEY: "sekret",
      } as Record<string, string>;

      // Without passEnv for AWS_*, AWS_SECRET_ACCESS_KEY should be empty
      const out1 = await $({ stdio: "pipe", env })`jio io.example.penv`;
      const obj1 = JSON.parse(String(out1.stdout)) as any;
      if (
        !(
          obj1.LANG &&
          obj1.LC_ALL &&
          obj1.SSL_CERT_FILE &&
          obj1.GIT_SSH_COMMAND &&
          obj1.SSH_AUTH_SOCK
        )
      ) {
        console.error("expected default kept env vars to be present, got:", obj1);
        process.exit(2);
      }
      if (obj1.AWS_SECRET_ACCESS_KEY) {
        console.error("expected AWS_SECRET_ACCESS_KEY to be absent without glob pass, got:", obj1);
        process.exit(2);
      }

      // With glob pass for AWS_* it should be present
      const out2 = await $({ stdio: "pipe", env })`jio io.example.penv --pass-env AWS_*`;
      const obj2 = JSON.parse(String(out2.stdout)) as any;
      if (obj2.AWS_SECRET_ACCESS_KEY !== "sekret") {
        console.error("expected AWS_SECRET_ACCESS_KEY via glob pass, got:", obj2);
        process.exit(2);
      }
    });
  });
});
