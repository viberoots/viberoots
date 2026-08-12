import process from "node:process";

export function establishVerifyOwnerPid(env = process.env, currentPid = process.pid) {
  const candidate = Number(String(env.VBR_VERIFY_OWNER_PID || "").trim());
  const ownerPid = Number.isFinite(candidate) && candidate > 1 ? candidate : currentPid;
  env.VBR_VERIFY_OWNER_PID = String(ownerPid);
  return ownerPid;
}
