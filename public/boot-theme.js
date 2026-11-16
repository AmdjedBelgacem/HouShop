// Theme + custom logo must apply BEFORE first paint so the loading
// animation and favicon match branding (React is not running yet).
// Loaded as an external script so the app can use a strict Content-Security-Policy.
(function () {
  try {
    if (localStorage.getItem('shop_theme') === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch (e) { /* ignore */ }
  try {
    var customLogo = localStorage.getItem('shop_logo_data_url');
    if (customLogo && customLogo.indexOf('data:image/') === 0) {
      window.__SHOP_CUSTOM_LOGO__ = customLogo;
    }
  } catch (e) { /* ignore */ }
  try {
    var customName = localStorage.getItem('shop_name');
    if (customName && customName.trim()) {
      window.__SHOP_CUSTOM_NAME__ = customName.trim();
    }
  } catch (e) { /* ignore */ }
})();
