/** Generic hash-bound provider artifact envelope. Evidence only, never formal scene authority. */

export const ARTIFACT_ENVELOPE_SCHEMA = "actiscape.artifact-envelope.v1";

export interface ArtifactEnvelopeV1 {
  schemaVersion: typeof ARTIFACT_ENVELOPE_SCHEMA;
  kind: "floorplan-vision";
  providerId: string;
  providerVersion: string;
  inputSha256: string;
  scopeHash: string;
  artifact: Record<string, unknown>;
  artifactSha256: string;
}
