// Applies the reader's stored theme and lesson text size to <html> before the first paint, so a
// light theme does not flash dark. A classic blocking script in <head>: module scripts run after
// parsing, too late. Same-origin file because the CSP (public/_headers) allows no inline script.
// Mirrors packages/ui/src/preferences.ts (keys, values, theme colors); keep them in step.
;(() => {
  const read = (key) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  const root = document.documentElement
  const theme = read("learn.theme")
  const textSize = read("learn.textSize")
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme)
  if (textSize === "sm" || textSize === "lg") root.setAttribute("data-text-size", textSize)
  const light =
    theme === "light" ||
    (theme !== "dark" &&
      typeof matchMedia === "function" &&
      matchMedia("(prefers-color-scheme: light)").matches)
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#ffffff" : "#010102")
})()
