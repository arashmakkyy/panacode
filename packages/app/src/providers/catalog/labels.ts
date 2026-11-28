export const PANAAI_PROVIDER_ID = "panaai"

export function modelDisplayName(providerID: string, name: string) {
  const label = name.replace("(latest)", "").trim()

  return providerID === PANAAI_PROVIDER_ID ? label.replace(/^panaai\s*\/\s*(?=\S)/i, "") : label
}
