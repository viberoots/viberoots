import type { InvalidationRow, ProviderIndexEntryExt } from "./invalidation-report-lib.ts";

export function formatTextRow(
  row: InvalidationRow,
  providerIndex: Record<string, ProviderIndexEntryExt>,
): string {
  const providers = row.module_providers;
  const providersDetail = providers.map((p) => {
    const e = providerIndex[p];
    if (!e) return p;
    const parts = [
      `${p}`,
      `kind=${String((e as any).kind || "")}`,
      `key=${String((e as any).key || "")}`,
    ];
    if ((e as any).patch_scope) parts.push(`patch_scope=${String((e as any).patch_scope)}`);
    return parts.join(" ");
  });
  const fields = [
    `target=${row.target}`,
    `langs=${row.langs.join(",") || "-"}`,
    `patch_scope=${row.patch_scope}`,
    `provider_model=${row.provider_model}`,
    row.lockfile_label ? `lockfile_label=${row.lockfile_label}` : `lockfile_label=-`,
    row.importer ? `importer=${row.importer}` : `importer=-`,
    row.lockfile ? `lockfile=${row.lockfile}` : `lockfile=-`,
    `importer_local_patches_action_inputs_expected=${row.importer_local_patches_action_inputs_expected ? "true" : "false"}`,
    `importer_local_patches_action_inputs_observed_in=${row.importer_local_patches_action_inputs_observed_in.join(",") || "-"}`,
    `package_local_patches_action_inputs_expected=${row.package_local_patches_action_inputs_expected ? "true" : "false"}`,
    `package_local_patches_action_inputs_observed_in=${row.package_local_patches_action_inputs_observed_in.join(",") || "-"}`,
    `global_nix_inputs_action_inputs_expected=${row.global_nix_inputs_action_inputs_expected ? "true" : "false"}`,
    `global_nix_inputs_action_inputs_observed_in=${row.global_nix_inputs_action_inputs_observed_in.join(",") || "-"}`,
    `global_nix_inputs_labels_stamped=${row.global_nix_inputs_labels_stamped ? "true" : "false"}`,
    `module_providers=[${providersDetail.join("; ")}]`,
  ];
  return fields.join("\t");
}
