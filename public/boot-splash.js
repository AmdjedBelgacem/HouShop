// Swap splash + tab icon to the cached custom logo as soon as the body exists.
// Loaded as an external script so the app can use a strict Content-Security-Policy.
(function () {
  var logo = window.__SHOP_CUSTOM_LOGO__;
  var name = window.__SHOP_CUSTOM_NAME__;
  if (logo) {
    var img = document.getElementById('splash-logo');
    if (img) img.src = logo;
    var link = document.querySelector("link[rel='icon']");
    if (link) {
      link.type = 'image/png';
      link.href = logo;
    }
  }
  if (name) {
    var brand = document.getElementById('splash-brand');
    if (brand) brand.textContent = name;
    document.title = name;
  }
})();
