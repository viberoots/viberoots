export function remoteCiToolsSourceIdentity(toolSourceRevision: string) {
  return {
    schema: "viberoots.remote-ci-tools-source-identity.v2" as const,
    toolSourceRevision,
    sourceTreeDigest: `sha256-${"A".repeat(43)}=`,
    sourceStorePath: `/nix/store/${"e".repeat(32)}-source`,
  };
}
