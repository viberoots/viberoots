import path from "node:path";
import { readOptional } from "./default-local-policy-files";
import { remoteEnvVars, type PolicyFinding } from "./default-local-policy-model";

function finding(file: string, message: string): PolicyFinding {
  return { severity: "error", path: file, message };
}

export async function checkBuckconfig(root: string): Promise<PolicyFinding[]> {
  const rel = ".buckconfig";
  const text = await readOptional(root, rel);
  const findings: PolicyFinding[] = [];
  if (/^\s*\[buck2_re_client(?:[.\]]|\])/m.test(text)) {
    findings.push(finding(rel, "committed Buck config selects a remote execution client"));
  }
  if (/^\s*\[build\][\s\S]*?^\s*execution_platforms\s*=/m.test(text)) {
    findings.push(
      finding(rel, "committed build.execution_platforms must not select remote platforms"),
    );
  }
  return findings;
}

export async function checkRemoteTestToolchain(root: string): Promise<PolicyFinding[]> {
  const rel = "toolchains/TARGETS";
  const text = await readOptional(root, rel);
  const block = matchCallBlock(text, "remote_test_execution_toolchain");
  if (!block) return [];
  const defaultProfile = /^\s*default_profile\s*=\s*(.+?)\s*,?\s*$/m.exec(block)?.[1]?.trim();
  const selected = defaultProfile && defaultProfile !== "None" && defaultProfile !== "null";
  return selected
    ? [finding(rel, "toolchains//:remote_test_execution selects a default_profile")]
    : [];
}

export async function checkCiRemoteEnvDefaults(
  root: string,
  files: string[],
): Promise<PolicyFinding[]> {
  const findings: PolicyFinding[] = [];
  for (const rel of files.filter(
    (f) => f === "Jenkinsfile" || f.startsWith("build-tools/tools/ci/"),
  )) {
    const text = await readOptional(root, rel);
    for (const envName of remoteEnvVars) {
      if (new RegExp(`\\b${envName}\\b\\s*(=|:)`).test(text)) {
        findings.push(finding(rel, `CI defaults set ${envName}`));
      }
    }
  }
  return findings;
}

export async function checkConfigSecrets(root: string, files: string[]): Promise<PolicyFinding[]> {
  const findings: PolicyFinding[] = [];
  for (const rel of files.filter(isConfigSurface)) {
    const text = await readOptional(root, rel);
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
      findings.push(finding(rel, "committed remote config surface contains inline PEM material"));
    }
    if (
      /"?(bearer|api[_-]?key|token|secret|signing[_-]?key)"?\s*[:=]\s*['"]?[A-Za-z0-9._~+/=-]{16,}/i.test(
        text,
      )
    ) {
      findings.push(
        finding(rel, "committed remote config surface contains secret-looking material"),
      );
    }
    if (
      /"?(cache[_-]?(credential|password|secret|token|access[_-]?key)|cache[_-]?key)"?\s*[:=]\s*['"]?[A-Za-z0-9._~+/=-]{12,}/i.test(
        text,
      )
    ) {
      findings.push(
        finding(rel, "committed remote config surface contains cache credential material"),
      );
    }
    if (
      /(?:https?|grpc):\/\/(?![^/\s"',}]+(?:example|invalid|localhost|127\.0\.0\.1))[^/\s"',}]+/i.test(
        text,
      )
    ) {
      findings.push(
        finding(rel, "committed remote config surface contains a real-looking endpoint"),
      );
    }
    if (/(ssh[_-]?key|identity[_-]?file)\s*[:=]\s*['"]?(\/|~\/|[A-Za-z]:\\)/i.test(text)) {
      findings.push(finding(rel, "committed remote config surface contains an SSH key path"));
    }
  }
  return findings;
}

export async function checkDirectBuckEntrypoints(
  root: string,
  files: string[],
): Promise<PolicyFinding[]> {
  const findings: PolicyFinding[] = [];
  for (const rel of files.filter(isBuckTestEntrypointSurface)) {
    const text = await readOptional(root, rel);
    for (const line of text.split(/\r?\n/).filter((v) => /\bbuck2\s+test\b/.test(v))) {
      if (/VBR_REMOTE_BUCK_CONFIG|--config-file|buck2_re_client|execution_platforms/.test(line)) {
        findings.push(
          finding(rel, "direct buck2 test entrypoint includes remote config by default"),
        );
      }
    }
  }
  return findings;
}

function matchCallBlock(text: string, callee: string): string {
  const start = text.indexOf(`${callee}(`);
  if (start < 0) return "";
  const end = text.indexOf("\n)", start);
  return text.slice(start, end < 0 ? undefined : end + 2);
}

function isConfigSurface(rel: string): boolean {
  const base = path.basename(rel).toLowerCase();
  return (
    rel === ".buckconfig" ||
    rel.startsWith("build-tools/tools/remote-exec/") ||
    /remote.*(template|example|fixture|config).*\.(json|toml|ya?ml|ini|cfg|buckconfig|txt)$/.test(
      base,
    )
  );
}

function isBuckTestEntrypointSurface(rel: string): boolean {
  return (
    rel === "package.json" ||
    rel === "TESTING.md" ||
    rel.startsWith("build-tools/tools/bin/") ||
    rel.startsWith("build-tools/tools/ci/") ||
    rel.startsWith("build-tools/tools/dev/") ||
    rel.startsWith("docs/")
  );
}
