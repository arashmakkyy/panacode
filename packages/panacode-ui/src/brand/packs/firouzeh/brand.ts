/** Brand pack manifest. script/panacode-brand-apply.ts reads `theme` to generate the app theme and icons. */
export const pack = {
  "id": "firouzeh",
  "name": "Panacode",
  "direction": "Firouzeh",
  "tagline": "Pure signal. Zero noise.",
  "taglineFa": "سیگنال خالص، بی‌نویز",
  "publisher": "PanaAI",
  "theme": {
    "dark": {
      "grey": {
        "50": "#F5FBFA",
        "100": "#E9F4F2",
        "200": "#D5E3E0",
        "300": "#C2D2CF",
        "400": "#A3B5B2",
        "500": "#7F938F",
        "600": "#5F7370",
        "700": "#3A4847",
        "800": "#263130",
        "900": "#1A2222",
        "1000": "#131919",
        "1100": "#0C1010",
        "1200": "#070909"
      },
      "accent": {
        "bg": "#14C4AD",
        "text": "#2EE6C8",
        "hover": "#62F0D8",
        "focus": "#2EE6C8",
        "codePath": "#62F0D8"
      },
      "palette": {
        "interactive": "#2EE6C8",
        "success": "#7EE36B",
        "warning": "#FFC24B",
        "error": "#FF5C7A"
      },
      "overrides": {
        "text-strong": "#E9F4F2",
        "text-base": "#A3B5B2",
        "text-weak": "#6F8380",
        "text-weaker": "#465553",
        "border-weak-base": "#1F2727",
        "border-weaker-base": "#172020",
        "icon-base": "#7F938F",
        "icon-weak-base": "#2F3B3A",
        "surface-raised-base": "#141919",
        "surface-raised-base-hover": "#1A2020",
        "surface-base": "#0F1313",
        "surface-base-hover": "#E9F4F20D",
        "surface-interactive-weak": "#0B2A26",
        "surface-success-base": "#0E2A12",
        "surface-critical-base": "#2A0B12",
        "syntax-constant": "#62F0D8"
      }
    },
    "light": {
      "grey": {
        "50": "#FFFFFF",
        "100": "#FBFDFC",
        "200": "#F2F6F5",
        "300": "#EAF0EF",
        "400": "#DAE3E1",
        "500": "#AEBBB8",
        "600": "#80918D",
        "700": "#5E6F6B",
        "800": "#3B4A47",
        "900": "#263330",
        "1000": "#172220",
        "1100": "#0D1715",
        "1200": "#060C0B"
      },
      "accent": {
        "bg": "#0B9F87",
        "text": "#0B8C77",
        "hover": "#067563",
        "focus": "#0B9F87",
        "codePath": "#067563"
      },
      "palette": {
        "interactive": "#0B9F87",
        "success": "#2F9E3A",
        "warning": "#B57F09",
        "error": "#D62F52"
      },
      "overrides": {
        "text-strong": "#091412",
        "text-base": "#4B5D59",
        "text-weak": "#80918D",
        "text-weaker": "#AEBBB8",
        "border-weak-base": "#DAE3E1",
        "border-weaker-base": "#E9EFEE",
        "icon-base": "#80918D",
        "icon-weak-base": "#BCCAC7",
        "surface-raised-base": "#F4F7F6",
        "surface-raised-base-hover": "#EAF0EF",
        "surface-base": "#F8FAFA",
        "surface-base-hover": "#0914120A",
        "surface-interactive-weak": "#E6F6F3",
        "syntax-constant": "#067563"
      }
    }
  }
} as const
