;(function () {
  var key = "opencode-theme-id"
  var themeId = localStorage.getItem(key) || "panacode"

  var scheme = localStorage.getItem("opencode-color-scheme") || "system"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"
  var ink = isDark ? "#EDEDED" : "#171717"
  var paper = isDark ? "#080808" : "#fafafa"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode
  document.documentElement.style.backgroundColor = paper
  document.documentElement.style.color = ink

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
