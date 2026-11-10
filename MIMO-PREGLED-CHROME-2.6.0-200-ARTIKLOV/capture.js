/* Read the rendered Mimovrste product, including lazy images and visible prices. */
(() => {
  try {
    const main = document.querySelector('main') || document.body;
    const text = (main.innerText || '').slice(0,55000);
    const item = MimoParser.parseProduct(document.documentElement.outerHTML, location.href, text);
    // The browser already resolved lazy/srcset resources. currentSrc is often
    // more reliable than the raw source HTML for storefront image galleries.
    const title = (item.title || '').toLocaleLowerCase('sl');
    const images = new Set([...(item.images || [])]);
    for (const img of [...main.querySelectorAll('img')].slice(0,100)) {
      if (images.size >= 12) break;
      const alt = (img.getAttribute('alt') || '').toLocaleLowerCase('sl');
      const withinGallery = !!img.closest('[data-testid*="gallery"], [class*="gallery"], [class*="Gallery"], [class*="product-image"]');
      const isNamed = title && (alt.includes(title.slice(0,24)) || title.includes(alt.slice(0,24)) && alt.length > 15);
      if (!withinGallery && !isNamed) continue;
      const raw = img.currentSrc || img.getAttribute('data-src') || img.src;
      try {
        const u = new URL(raw, location.href);
        if (u.protocol !== 'https:' || /logo|favicon|placeholder|pixel|sprite/i.test(u.pathname)) continue;
        if (img.naturalWidth && img.naturalWidth < 85) continue;
        images.add(u.href);
      } catch (_) {}
    }
    item.images = [...images].slice(0,12);
    item.image ||= item.images[0] || '';
    return {item};
  } catch (error) {
    return {error: String(error?.message || 'Podatkov na odprti strani ni bilo mogoče prebrati.')};
  }
})();
