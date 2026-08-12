const { execFile } = await import("node:child_process");

function inspectNumericProcessRows() {
  return new Promise((resolve, reject) => {
    execFile(
      "ps",
      ["-A", "-o", "pid=,ppid="],
      { encoding: "utf8", timeout: 2_000 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(
          String(stdout || "")
            .split(/\r?\n/u)
            .map((line) => line.trim().replace(/\s+/gu, " "))
            .filter(Boolean),
        );
      },
    );
  });
}

function parseProcessRows(lines) {
  return lines.map((line) => {
    const match = line.match(/^(\d+)\s+(\d+)$/u);
    if (!match) throw new Error(`invalid numeric process row: ${JSON.stringify(line)}`);
    return { pid: Number(match[1]), ppid: Number(match[2]) };
  });
}

export function descendantPids(lines, rootPid) {
  const children = new Map();
  for (const row of parseProcessRows(lines)) {
    const current = children.get(row.ppid) || [];
    current.push(row.pid);
    children.set(row.ppid, current);
  }
  const result = [];
  const seen = new Set([rootPid]);
  const visit = (pid) => {
    for (const child of children.get(pid) || []) {
      if (seen.has(child)) continue;
      seen.add(child);
      visit(child);
      result.push(child);
    }
  };
  visit(rootPid);
  return result;
}

function signalQuietly(signal, pid, value) {
  try {
    signal(pid, value);
    return true;
  } catch {
    return false;
  }
}

export async function killZxProcessTree(pid, signal = "SIGTERM", deps = {}) {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error(`invalid process pid: ${pid}`);
  const inspect = deps.inspect || inspectNumericProcessRows;
  const send = deps.signal || process.kill.bind(process);
  let descendants = [];
  try {
    descendants = descendantPids(await inspect(), pid);
  } catch {
    // The process group remains the authoritative termination boundary.
  }
  for (const child of descendants) signalQuietly(send, child, signal);
  if (!signalQuietly(send, -pid, signal)) signalQuietly(send, pid, signal);
}

export function installZxProcessKill(zx) {
  if (zx && process.platform !== "win32") zx.kill = killZxProcessTree;
}
