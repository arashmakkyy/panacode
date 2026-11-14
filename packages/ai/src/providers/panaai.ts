import type { ProviderPackage } from "../provider-package.js"
import { PanaAIChat } from "../protocols/panaai-chat.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import { ProviderID, type ModelID, type RequestOptions } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"
import { bearerRouteDefaults, toConfig } from "./settings.js"

export const id = ProviderID.make("panaai")
/** Temporary Vercel host; switch to a custom domain via product overlay when ready. */
export const baseURL = "https://panaai-psi.vercel.app/v1"

export type Config = Omit<RequestOptions, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  OpenAIProviderOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

export const route = PanaAIChat.route.with({
  provider: id,
  endpoint: { baseURL },
})

export const routes = [route]

export const configure = (input: Config = {}) => {
  const configured = route.with(bearerRouteDefaults(input, "PANAAI_API_KEY", baseURL))
  return {
    id,
    model: (modelID: string | ModelID) => configured.model<OpenAIProviderOptionsInput>({ id: modelID }),
    configure,
  }
}

export const provider = configure()

export const model: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (modelID, settings) =>
  configure(toConfig(settings)).model(modelID)

export * as PanaAI from "./panaai.js"
