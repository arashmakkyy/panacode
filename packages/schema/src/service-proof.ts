import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export type ServiceProofState = "ready" | "starting" | "stopping" | "failed"
export const serviceProofPath = "/api/.well-known/panacode-service"
export const serviceProofHeader = "x-panacode-service-proof"

export function newServiceChallenge() {
  return randomBytes(32).toString("hex")
}

export function deriveServiceProofKey(token: string) {
  return createHmac("sha256", token).update("panacode.http.proof.key.v1").digest("hex")
}

export function serviceProofRequest(origin: string, challenge: string, instance?: string) {
  const url = new URL(serviceProofPath, origin)
  url.searchParams.set("challenge", challenge)
  if (instance) url.searchParams.set("instance", instance)
  return url
}

export function signServiceProof(
  key: string,
  challenge: string,
  instance: string | undefined,
  state: ServiceProofState,
) {
  const mac = createHmac("sha256", key)
    .update(JSON.stringify(["panacode.http.proof.v1", challenge, instance ?? "", state]))
    .digest("hex")
  return state + "." + mac
}

export function verifyServiceProof(
  header: string | null | undefined,
  key: string,
  challenge: string,
  instance?: string,
) {
  if (!header || !/^[a-f0-9]{64}$/.test(challenge)) return
  const state = header.split(".", 1)[0]
  if (state !== "ready" && state !== "starting" && state !== "stopping" && state !== "failed") return
  const expected = Buffer.from(signServiceProof(key, challenge, instance, state))
  const received = Buffer.from(header)
  if (expected.length === received.length && timingSafeEqual(expected, received)) return state
}
