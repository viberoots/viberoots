#!/usr/bin/env zx-wrapper
process.env.VBR_UPDATE_COMMAND_LAUNCHER_CASE = "upgrade-languages";
await import("./update-command.launcher.integration.test.ts");
