#!/usr/bin/env zx-wrapper
process.env.VBR_UPDATE_COMMAND_LAUNCHER_CASE = "tool-authority-conflict";
await import("./update-command.launcher.integration.test.ts");
