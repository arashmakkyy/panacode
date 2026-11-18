;(function () {
  var key = "opencode-theme-id"
  // Panacode defaults to its own theme; oc-2 remains available once chosen.
  var themeId = localStorage.getItem(key) || "panacode"

  var scheme = localStorage.getItem("opencode-color-scheme") || "system"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"
  var paper = isDark ? "#080808" : "#fafafa"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode
  document.documentElement.dataset.brand = "panacode"
  document.documentElement.style.backgroundColor = paper
  document.documentElement.style.colorScheme = mode

  // Seed high-contrast ink/surface before theme CSS arrives so splash + error
  // logs never render black-on-black or white-on-white on first paint.
  var seed = document.createElement("style")
  seed.id = "oc-theme-preload-seed"
  seed.textContent = isDark
    ? ":root{color-scheme:dark;--text-strong:#ededed;--text-weak:#707070;--input-base:#1c1c1c;--icon-base:#7e7e7e;--icon-weak-base:#a0a0a0;--icon-strong-base:#ededed;--v2-background-bg-base:#161616;--v2-background-bg-deep:#080808;--v2-text-text-base:#ededed;}"
    : ":root{color-scheme:light;--text-strong:#171717;--text-weak:#8f8f8f;--input-base:#fcfcfc;--icon-base:#8f8f8f;--icon-weak-base:#c7c7c7;--icon-strong-base:#171717;--v2-background-bg-base:#fafafa;--v2-background-bg-deep:#f2f2f2;--v2-text-text-base:#171717;}"
  document.head.appendChild(seed)

  // Update theme-color meta tag to match app color scheme
  var metas = document.querySelectorAll("meta[name='theme-color']")
  if (metas.length > 0) metas[0].setAttribute("content", paper)

  // Built-in themes ship CSS with the app bundle; only custom themes need cached CSS before paint.
  if (themeId === "oc-2" || themeId === "panacode") return

  var css = localStorage.getItem("opencode-theme-css-" + mode)
  if (css) {
    var style = document.createElement("style")
    style.id = "oc-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
