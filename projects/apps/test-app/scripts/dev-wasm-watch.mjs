import { spawn } from "node:child_process";

const child = spawn("zx-wrapper", ["../../../build-tools/tools/dev/watch-wasm-producer.ts"], {
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
