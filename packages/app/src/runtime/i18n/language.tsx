import { createEffect, createSignal, type JSX } from "solid-js"
import { createSimpleContext } from "@opencode/ui/context"
import {
  I18nProvider,
  type UiI18n,
  pluralCategory,
  resolveTemplate,
  type UiI18nPluralLookupKey,
  type UiI18nPluralKey,
  type UiPluralCategory,
} from "@opencode/ui/context/i18n"
import en from "@/runtime/i18n/en"
import { dict } from "@opencode/ui/i18n/en"
import {
  createDesktopNativeBundle,
  DESKTOP_NATIVE_ENGLISH,
  type DesktopNativeBundle,
  type DesktopNativeLocale,
} from "@/runtime/i18n/desktop-native"

export type Locale = DesktopNativeLocale

export type Direction = "ltr" | "rtl"

type AppI18nKey = Extract<keyof typeof en, string>

type AppI18nPluralKey = {
  [Key in AppI18nKey]: Key extends `${infer Base}.other` ? (`${Base}.one` extends AppI18nKey ? Base : never) : never
}[AppI18nKey]

type PluralKey = AppI18nPluralKey | UiI18nPluralKey

type AppI18nPluralLookupKey = `${AppI18nPluralKey}.${UiPluralCategory}`

type TranslationKey<Key extends Extract<keyof Dictionary, string>> = Key extends
  | AppI18nPluralLookupKey
  | UiI18nPluralLookupKey
  ? never
  : Key

type Dictionary = typeof en & typeof dict

const dictionary: Dictionary & Partial<Record<AppI18nPluralLookupKey | UiI18nPluralLookupKey, string>> = { ...en, ...dict }

const locale = () => "en" as const

export function richTemplateParts<Value>(template: string, params: Record<string, Value>) {
  return template
    .split(/({{\s*[^}]+?\s*}})/g)
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^{{\s*([^}]+?)\s*}}$/)

      if (!match) return part

      return params[match[1]] ?? ""
    })
}

export function localizedListParts<Value>(locale: string, items: readonly Value[]) {
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" })
    .formatToParts(items.map((_, index) => String(index)))
    .map((part) => (part.type === "element" ? items[Number(part.value)] : part.value))
}

/** The English catalog is bundled with the shell. Older desktop hosts can still call these entry points. */
export function normalizeLocale(_value: string): Locale {
  return locale()
}

export function loadLocaleDict(_value: string): Promise<void> {
  return Promise.resolve()
}

export const { use: useLanguage, provider: LanguageProvider } = createSimpleContext({
  name: "Language",
  gate: false,
  init: (props: { locale?: string; onNativeTranslations?: (bundle: DesktopNativeBundle) => void }) => {
    const [direction, setDirection] = createSignal<Direction>("ltr")
    const layoutLocale = () => (direction() === "rtl" ? "ar" : locale())

    const t = <Key extends Extract<keyof Dictionary, string>>(
      key: TranslationKey<Key>,
      params?: Record<string, string | number | boolean>,
    ) => {
      const template: string | undefined = dictionary[key]

      // A key outside the dictionary translates to nothing, as it did with the package translator.
      return template === undefined ? template : resolveTemplate(template, params)
    }

    const pluralForm = (
      key: PluralKey,
      category: UiPluralCategory,
      params?: Record<string, string | number | boolean>,
    ) => {
      const candidate = `${key}.${category}` as const
      const fallback = `${key}.other` as const

      return resolveTemplate(dictionary[candidate] ?? dictionary[fallback] ?? fallback, params)
    }

    const plural = (key: PluralKey, count: number, params?: Record<string, string | number | boolean>) =>
      pluralForm(key, pluralCategory(locale(), count), { ...params, count })

    // "2 subagents · 1 shell", or one group alone, as the iOS app's background-work capsule reads.
    const activitySummary = (counts: { subagents: number; shells: number }) => {
      const subagents = counts.subagents ? plural("session.activity.subagents", counts.subagents) : undefined
      const shells = counts.shells ? plural("session.activity.shells", counts.shells) : undefined

      if (subagents && shells) return t("session.activity.summary", { subagents, shells })

      return subagents ?? shells ?? ""
    }

    const tDynamic = <Key extends Extract<keyof Dictionary, string>>(
      _key: TranslationKey<Key>,
      source: string,
      params?: Record<string, string | number | boolean>,
    ) => resolveTemplate(source, params)

    const rich = <Key extends Extract<keyof Dictionary, string>>(
      key: TranslationKey<Key>,
      params: Record<string, JSX.Element>,
    ) => {
      return richTemplateParts(dictionary[key] ?? key, params)
    }

    const activitySummaryRich = (
      counts: { subagents: number; shells: number },
      render: (label: string) => JSX.Element,
    ) => {
      if (!counts.subagents || !counts.shells) return render(activitySummary(counts))

      return rich("session.activity.summary", {
        subagents: render(activitySummary({ subagents: counts.subagents, shells: 0 })),
        shells: render(activitySummary({ subagents: 0, shells: counts.shells })),
      })
    }

    const list = (items: readonly JSX.Element[]) => localizedListParts(locale(), items)

    createEffect(() => {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- probing for a browser global
      if (typeof document !== "object") return
      document.documentElement.lang = locale()
      document.documentElement.dir = direction()
      document.cookie = "oc_locale=en; Path=/; Max-Age=31536000; SameSite=Lax"
    })

    createEffect(() => {
      if (!props.onNativeTranslations) return
      props.onNativeTranslations(
        createDesktopNativeBundle(locale(), (key) => dictionary[key] ?? DESKTOP_NATIVE_ENGLISH[key]),
      )
    })

    return {
      locale,
      intl: locale,
      direction,
      layoutLocale,
      t,
      tDynamic,
      plural,
      pluralForm,
      activitySummary,
      activitySummaryRich,
      rich,
      list,
      setDirection(next: Direction) {
        setDirection(next)
      },
    }
  },
})

export function UiI18nBridge(props: { children?: JSX.Element }) {
  const language = useLanguage()

  return (
    <I18nProvider
      value={{
        locale: language.intl,
        layoutLocale: language.layoutLocale,
        // SAFETY: `t` accepts the UI keys, which are a subset of the app dictionary.
        t: language.t as UiI18n["t"],
        plural: language.plural,
        pluralForm: language.pluralForm,
      }}
    >
      {props.children}
    </I18nProvider>
  )
}
