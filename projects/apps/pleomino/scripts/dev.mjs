import { spawn } from "node:child_process";

const child = spawn(
  "zx-wrapper",
  [
    "../../../build-tools/tools/dev/dev-with-wasm-watch.ts",
    "--vite-cmd",
    "pnpm run dev:vite",
    "--watch-cmd",
    "pnpm run dev:wasm:watch",
  ],
  { stdio: "inherit" },
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
