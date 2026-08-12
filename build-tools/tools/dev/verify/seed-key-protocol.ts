import { PREPARED_MARKER, STAGE_ROOT_PROTOCOL_DIR } from "./seed-stage-layout";

export function seedProtocolIdentity(
  preparedMarker = PREPARED_MARKER,
  stageRootProtocolDir = STAGE_ROOT_PROTOCOL_DIR,
): { preparedMarker: string; stageRootProtocolDir: string } {
  return { preparedMarker, stageRootProtocolDir };
}
