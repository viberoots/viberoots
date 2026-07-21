import fs from "node:fs";
import path from "node:path";
import { renderRemoteTestActivationConfigText } from "../../remote-exec/remote-test-activation";

export function remoteActivationConfigPath(opts: {
  activationDir: string | null;
  passName: string;
  targetProfile: string | null;
}): string {
  if (!opts.activationDir) {
    throw new Error(
      `remote verify selected test profile ${opts.targetProfile || "<none>"} for pass ${opts.passName}, but VBR_REMOTE_TEST_ACTIVATION_DIR is required`,
    );
  }
  if (!opts.targetProfile) {
    throw new Error(`remote verify did not select a test profile for ${opts.passName}`);
  }
  const configPath = path.join(opts.activationDir, `${opts.passName}.buckconfig`);
  const configText = renderRemoteTestActivationConfigText({
    artifactDir: opts.activationDir,
    passName: opts.passName,
    targetProfile: opts.targetProfile,
  });
  fs.mkdirSync(opts.activationDir, { recursive: true });
  fs.writeFileSync(configPath, configText, { mode: 0o600 });
  return configPath;
}
