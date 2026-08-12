#!/usr/bin/env zx-wrapper
process.env.VBR_UPDATE_COMMAND_LAUNCHER_CASE = "upgrade-pnpm";
await import("./update-command.launcher.integration.test.ts");
