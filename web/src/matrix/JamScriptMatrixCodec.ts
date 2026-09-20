import * as JamScriptClient from "@jamscript/client";

/** Mirrors the public JamScript Matrix proof shape without re-encoding it in Locus. */
export type MatrixControlClaimProofV1 = {
  userId: string;
  selfSigningPublicKey: Uint8Array;
  masterSignature: Uint8Array;
  deviceId: string;
  algorithms: string[];
  deviceCurve25519Key: Uint8Array;
  deviceEd25519Key: Uint8Array;
  selfSigningSignature: Uint8Array;
};

type MatrixCodecSurface = {
  encodeMatrixControlClaimProofV1?: (proof: MatrixControlClaimProofV1) => Uint8Array;
  decodeMatrixControlClaimProofV1?: (bytes: Uint8Array) => MatrixControlClaimProofV1;
};

function surface(): MatrixCodecSurface {
  return JamScriptClient as unknown as MatrixCodecSurface;
}

/** Delegate proof encoding to the published JamScript client. */
export function encodeMatrixControlClaimProofV1(proof: MatrixControlClaimProofV1): Uint8Array {
  const codec = surface().encodeMatrixControlClaimProofV1;
  if (!codec) throw new Error("JAMSCRIPT_CLIENT_MATRIX_CODEC_UNAVAILABLE");
  return codec(proof);
}

export function decodeMatrixControlClaimProofV1(bytes: Uint8Array): MatrixControlClaimProofV1 {
  const codec = surface().decodeMatrixControlClaimProofV1;
  if (!codec) throw new Error("JAMSCRIPT_CLIENT_MATRIX_CODEC_UNAVAILABLE");
  return codec(bytes);
}
