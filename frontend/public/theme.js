// Applies the saved appearance before the page paints (no flash of the other theme).
// A separate file because the Content-Security-Policy allows no inline scripts.
try {
  var theme = localStorage.getItem("glioma.theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch (error) {
  /* storage unavailable: follow the system setting */
}
