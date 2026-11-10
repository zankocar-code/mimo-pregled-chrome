/* Mimo Pregled 2.1: public product pages, exact on-page article number proof. */
(function (scope) {
  'use strict';
  const BASE = 'https://www.mimovrste.com';
  const ID_RE = /^\d{4,18}$/;
  const BLOCKED = /^\/(?:api|id|user|uporabnik|kosarica|checkout|account|profil|prijava|registracija|kampanja|pomoc|kontakt|seznami)(?:\/|$)/i;

  function clean(t, n = 3000) { return String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n); }
  function cleanURL(input, allowSearch = false) {
    try {
      const u = new URL(clean(input, 3000));
      if (u.protocol !== 'https:' || !['mimovrste.com', 'www.mimovrste.com'].includes(u.hostname.toLowerCase()) || BLOCKED.test(u.pathname)) return null;
      if (u.pathname === '/') return null;
      if (u.pathname.replace(/\/$/, '') === '/iskanje') {
        if (!allowSearch) return null;
        const id = u.searchParams.get('s') || u.searchParams.get('q');
        const key = u.searchParams.has('s') ? 's' : 'q';
        return ID_RE.test(id || '') ? BASE + '/iskanje?' + key + '=' + encodeURIComponent(id) : null;
      }
      return BASE + u.pathname.replace(/\/$/, '');
    } catch (_) { return null; }
  }
  function searchURL(id, key = 's') { return ID_RE.test(String(id)) ? BASE + '/iskanje?' + (key === 'q' ? 'q' : 's') + '=' + encodeURIComponent(id) : null; }
  function searchURLs(id) { return [searchURL(id,'s'),searchURL(id,'q')].filter(Boolean); }
  // A direct ID route is only a tentative lookup. Accept it solely if the final
  // product page contains the exact, independently verified item number.
  function directIDURL(id) { return ID_RE.test(String(id)) ? BASE + '/izdelek/' + encodeURIComponent(id) : null; }
  function idFromURL(u) { const m = (u || '').match(/-(\d{5,18})(?:\/?(?:\?.*)?)?$/); return m ? m[1] : ''; }
  function splitEntries(value) {
    // Accept one ID per line, whitespace-separated IDs, URLs, "ID | URL",
    // and a pasted Markdown/CSV table like "| 53242197 |".
    const chunks = String(value || '').split(/[\n\r;,]+/);
    const result = []; let ignored = 0;
    for (let raw of chunks) {
      raw = raw.trim();
      if (!raw || /^\|?\s*:?-{3,}:?\s*\|?$/.test(raw)) continue;
      // Treat a single-cell Markdown row as an ID, not an ID|URL pair.
      if (/^\|\s*\d{4,18}\s*\|$/.test(raw)) raw = raw.replace(/\|/g,'').trim();
      // Also support multi-column Markdown rows: | 53242197 | https://... |
      if (/^\|.+\|$/.test(raw)) raw = raw.slice(1,-1).trim();
      const parts = /^\d{4,18}(?:\s+\d{4,18})+$/.test(raw) ? raw.split(/\s+/) : [raw];
      for (const part of parts) {
        const entry = part.trim(); if (!entry) continue;
        let id = '', url = null;
        if (entry.includes('|')) {
          const pair = entry.split('|', 2);
          id = pair[0].trim(); url = cleanURL(pair[1].trim());
          if (!ID_RE.test(id)) { ignored++; continue; }
        } else if (/^https?:\/\//i.test(entry)) url = cleanURL(entry);
        else if (ID_RE.test(entry)) id = entry;
        if (!id && url) id = idFromURL(url);
        if ((!id && !url) || (!url && !ID_RE.test(id))) { ignored++; continue; }
        result.push({ id, url });
      }
    }
    return { entries: result, ignored };
  }
  function parseMoney(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value < 100000000 ? value : null;
    if (value == null) return null;
    let s = String(value).replace(/\s|\u00a0|\u202f|€|EUR/gi, '').replace(/[^\d.,-]/g, '');
    if (!s || s.startsWith('-')) return null;
    const dot = s.lastIndexOf('.'), comma = s.lastIndexOf(',');
    if (dot >= 0 && comma >= 0) s = dot > comma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
    else if (comma >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 && n < 100000000 ? Math.round(n * 100) / 100 : null;
  }
  function safeImage(raw, base) {
    const value = typeof raw === 'object' && raw !== null ? (raw.contentUrl || raw.url || raw.src) : raw;
    if (value == null || !String(value).trim()) return '';
    try {
      const u = new URL(String(value).trim(), base);
      if (u.protocol !== 'https:' || u.href.length > 2200 || /\.(?:svg|gif)(?:[?#]|$)/i.test(u.pathname)) return '';
      // Reject tracking pixels, generic icons and logos.
      if (/(?:logo|favicon|placeholder|tracking|spacer|sprite|cookie-icon)/i.test(u.pathname)) return '';
      return u.href;
    } catch (_) { return ''; }
  }
  function getDoc(html) {
    if (typeof DOMParser === 'undefined') throw new Error('Razčlenjevalnik HTML ni na voljo.');
    return new DOMParser().parseFromString(html, 'text/html');
  }
  function selectText(el) { return el ? clean(el.textContent || '') : ''; }
  function metaContent(doc, ...names) {
    for (const name of names) {
      const m = [...doc.querySelectorAll('meta[content]')].find(e => (e.getAttribute('property') || e.getAttribute('name') || '').toLowerCase() === name.toLowerCase());
      if (m) return clean(m.getAttribute('content'));
    }
    return '';
  }
  function jsonProducts(data) {
    const found = []; const seen = new WeakSet();
    function walk(v, depth) {
      if (depth > 12 || !v || typeof v !== 'object' || seen.has(v)) return;
      seen.add(v);
      if (Array.isArray(v)) { v.forEach(x => walk(x, depth + 1)); return; }
      const kind = Array.isArray(v['@type']) ? v['@type'] : [v['@type']];
      if (kind.some(x => /^(?:https?:\/\/schema\.org\/)?Product$/i.test(x || ''))) { found.push(v); return; }
      for (const key of ['@graph','mainEntity','item','product','hasVariant']) if (v[key]) walk(v[key], depth + 1);
    }
    walk(data, 0); return found;
  }
  function specAdd(dest, k, v) {
    const key = clean(k, 70).replace(/[:\s]+$/, ''); const value = clean(v, 230);
    if (!key || !value || key.length < 2 || value === key || Object.keys(dest).length >= 42) return;
    if (!Object.prototype.hasOwnProperty.call(dest, key)) dest[key] = value;
  }
  function jsonIdentifiers(product) {
    const ids = [];
    for (const key of ['sku','mpn','productID','gtin','gtin8','gtin12','gtin13','gtin14']) {
      const v = product?.[key]; if ((typeof v === 'string' || typeof v === 'number') && ID_RE.test(String(v))) ids.push(String(v));
    }
    return ids;
  }
  // Search pages frequently contain many unrelated product links. A result is only
  // accepted once the full product page itself contains the exact requested ID.
  function searchCandidates(html, id) {
    if (!ID_RE.test(String(id))) return [];
    const doc = getDoc(html), collected = new Map();
    function add(raw, context = '', isProductTile = false) {
      let url;
      try { url = cleanURL(new URL(String(raw).replace(/\\\//g, '/'), BASE).href); } catch (_) { return; }
      if (!url || url.includes('/iskanje') || url.split('/').length < 5) return;
      const tail = decodeURIComponent(url.split('/').pop());
      if (!tail || tail.length < 8 || !tail.includes('-')) return;
      const suffix = idFromURL(url), exact = suffix === id;
      const contextMatch = new RegExp('(^|\\D)' + id + '(\\D|$)').test(clean(context, 1100));
      const score = (exact ? 500 : 0) + (contextMatch ? 220 : 0) + (isProductTile ? 30 : 0) + (suffix ? 10 : 0);
      // Even without an ID in the slug, the candidate must later be confirmed on
      // its own product page. Never trust search ordering as identity proof.
      if (!collected.has(url) || collected.get(url) < score) collected.set(url, score);
    }
    for (const a of doc.querySelectorAll('a[href]')) {
      const tile = a.closest('[data-testid*="product"], [data-test*="product"], article, [class*="product-card"], [class*="ProductCard"], [class*="productTile"], [class*="ProductTile"]');
      add(a.getAttribute('href'), (tile || a).textContent || '', !!tile);
    }
    // Hydration data often contains URLs that were not yet rendered as links.
    if (collected.size < 5) {
      const pattern = /(?:https?:\\?\/\\?\/www\.mimovrste\.com)?\\?\/(?:[\w%-]+)\\?\/([\w%-]+-\d{5,18})/g;
      for (const match of html.matchAll(pattern)) {
        if (collected.size > 60) break;
        add(match[0].replace(/\\\//g, '/'));
      }
    }
    return [...collected.entries()].sort((a,b) => b[1]-a[1]).slice(0, 12)
      .map(([url, score]) => ({url, exactURL: score >= 500}));
  }
  function resolveID(html, id) { return searchCandidates(html, id).find(x => x.exactURL)?.url || null; }

  function getPictures(doc, product, pageUrl, title) {
    const choices = []; const seen = new Set();
    function add(raw, rank) {
      if (Array.isArray(raw)) { raw.forEach(v => add(v, rank)); return; }
      const url = safeImage(raw, pageUrl); if (!url) return;
      // /i/IMAGEID/360/360 and /i/IMAGEID/720/720 are the same photo.
      const fingerprint = url.replace(/\/i\/(\d+)\/\d+\/\d+(?=\/|\?|$)/, '/i/$1/SIZE/SIZE').split('?')[0];
      if (seen.has(fingerprint)) return;
      seen.add(fingerprint); choices.push({ url, rank, fingerprint });
    }
    function srcset(el, rank) {
      const value = el?.getAttribute('srcset') || el?.getAttribute('data-srcset') || '';
      if (!value) return;
      const sizes = value.split(',').map(x => x.trim()).map(x => {
        const m = x.match(/^(\S+)(?:\s+([\d.]+)([wx]))?$/); return m ? {url:m[1], size:Number(m[2] || 0)} : null;
      }).filter(Boolean).sort((a,b) => b.size-a.size);
      if (sizes.length) add(sizes[0].url, rank);
    }
    add(product?.image, 120);
    add(metaContent(doc,'og:image','twitter:image','twitter:image:src'), 108);
    const gallerySelectors = '[data-testid*="gallery"] img, [class*="gallery"] img, [class*="Gallery"] img, [class*="product-image"] img, [class*="productImage"] img, [class*="ProductImage"] img, [itemprop="image"], main picture img, main picture source';
    for (const e of [...doc.querySelectorAll(gallerySelectors)].slice(0, 80)) {
      srcset(e, 100);
      for (const attr of ['data-zoom-image','data-large-image','data-original','data-lazy-src','data-src','src','content']) add(e.getAttribute(attr), 92);
      if (e.tagName === 'IMG') {
        for (const source of e.closest('picture')?.querySelectorAll('source') || []) srcset(source, 100);
      }
      if (choices.length > 32) break;
    }
    // Very conservative fallback for lazy-loaded product pictures outside a gallery.
    if (choices.length === 0) {
      const words = title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 3).slice(0, 4);
      for (const img of [...doc.querySelectorAll('main img, article img')].slice(0, 45)) {
        const alt = (img.getAttribute('alt') || '').toLowerCase();
        if (alt && words.some(w => alt.includes(w))) {
          srcset(img, 60); add(img.getAttribute('data-src') || img.getAttribute('src'), 55);
        }
      }
    }
    return choices.sort((a,b) => b.rank-a.rank).slice(0, 10).map(x => x.url);
  }
  function pageText(doc) {
    const main = doc.querySelector('main') || doc.body;
    const walker = doc.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let n, texts = [], count = 0;
    while ((n = walker.nextNode()) && count < 65000) {
      if (n.parentElement?.closest('script,style,noscript,svg,nav,footer')) continue;
      const t = clean(n.nodeValue, 1500);
      if (t) { texts.push(t); count += t.length; }
    }
    return texts.join(' ');
  }
  function allEuros(text) {
    const found = [];
    // Currency MUST be near number; never parse whole containers as one price.
    // Text surrounding a coupon often contains a year, e.g. '2026 589,29 €'.
    // NEVER interpret ordinary spaces as thousands separators here. A separate
    // DOM price node still accepts proper thousands spaces via parseMoney().
    for (const match of String(text).matchAll(/(?<![\d.,])(?:\d{1,3}(?:[.\u00a0\u202f]\d{3})+|\d{1,7})(?:[,.]\d{1,2})?\s*(?:€|EUR)/gi)) {
      const value = parseMoney(match[0]);
      if (value !== null && value > 0) found.push({value, at:match.index, raw:match[0]});
    }
    return found;
  }
  function readOfferArea(doc, title, result, visibleText = '') {
    const text = visibleText || pageText(doc);
    let at = title ? text.toLowerCase().indexOf(clean(title).toLowerCase().slice(0, 65)) : -1;
    if (at < 0) at = 0;
    // Pricing is placed just after the primary title, before technical details
    // and recommendations. Site navigational/footer promo codes are excluded.
    let excerpt = text.slice(at, at + 2300);
    const end = excerpt.search(/(?:Tehnične podrobnosti|Tehnične specifikacije|Predstavitev|Mnenja kupcev)/i);
    if (end > 150) excerpt = excerpt.slice(0, end);
    const purchaseEnd = excerpt.search(/\b(?:V košarico|Dodaj v košarico|Zanima me)\b/i);
    const priceSection = purchaseEnd >= 90 ? excerpt.slice(0, purchaseEnd) : excerpt.slice(0, 1100);
    const euros = allEuros(priceSection);
    if (result.price == null) {
      // Explicit reference-price phrase: "74,99 € Najnižja cena ... 69,99 €".
      const lowest = /Najnižja cena v zadnjih 30 dneh pred znižanjem/i.exec(excerpt);
      if (lowest) {
        const before = euros.filter(x => x.at + x.raw.length <= lowest.index + 5);
        const after = euros.filter(x => x.at >= lowest.index + lowest[0].length).slice(0, 2);
        if (before.length && after.length && before.at(-1).value > after[0].value) {
          result.price = after[0].value;
          result.oldPrice = before.at(-1).value;
        }
      }
    }
    if (result.price == null) {
      const sale = excerpt.match(/(?:Spletna cena|Cena na spletu|Akcijska cena|Znižana cena|Prodajna cena)\s*:?\s*(\d[\d.,\s]*\s*€)/i);
      if (sale) result.price = parseMoney(sale[1]);
    }
    if (result.price == null && euros.length) {
      // When the page has only one price near the title, treat it as current.
      // "Prihranite X €" is a saving, not a price.
      const prices = euros.filter(e => {
        const before = excerpt.slice(Math.max(0, e.at - 90),e.at);
        const after = excerpt.slice(e.at + e.raw.length,e.at + e.raw.length + 24);
        return !/(?:prihranite|dostava|poštnina|darilo|donirali|vrednost bona)\s*:?\s*$/i.test(before)
          && !/^\s*s\s*kodo\b/i.test(after) && !/\b(?:s kodo|cena s kodo)\s*:?\s*$/i.test(before)
          && e.value > 0 && e.value < 100000;
      });
      // Never take an arbitrary last currency value: it may be a suggested
      // product price, a gift or an older price from the page description.
      if (prices.length === 1) result.price = prices[0].value;
      else if (prices.length >= 2) {
        const end = excerpt.search(/(?:V košarico|Dodaj v košarico)/i);
        const candidates = prices.filter(p => end < 0 || p.at < end);
        if (candidates.length && new Set(candidates.map(p=>p.value)).size === 1) result.price = candidates[0].value;
      }
    }
    if (result.price != null && result.oldPrice == null) {
      const lowest = /Najnižja cena v zadnjih 30 dneh pred znižanjem/i.exec(excerpt);
      if (lowest) {
        const before = euros.filter(x => x.at + x.raw.length <= lowest.index + 5);
        const val = before.at(-1)?.value;
        if (val > result.price) result.oldPrice = val;
      }
    }
    // Display price available ONLY after entering a promotional code.
    const promoMatch = priceSection.match(/(\d[\d.,\s]*\s*€)\s*s kodo/i)
      || excerpt.match(/(?:Cena\s+s\s+kodo|Cena\s+ob\s+uporabi\s+kode)\s*[:–-]?\s*(\d[\d.,\s]*\s*€)/i);
    if (promoMatch) result.promoPrice = parseMoney(promoMatch[1]);
    const codePatterns = [
      /(?:PROMO(?:CIJSKA)?\s+KODA|KODA\s+ZA\s+POPUST)[^\n.]{0,90}?\bs kodo\s+([A-Z0-9-]{4,28})\b/i,
      /\bs kodo\s+([A-Z0-9-]{4,28})\b/i,
      /\b(?:promo(?:cijska)?\s*koda|koda\s*za\s*popust)\s*[:–-]\s*([A-Z0-9-]{4,28})\b/i,
      /\b(?:koda|kodo|promo koda|promo kodo)\s+([A-Z0-9-]{4,28})\b/i
    ];
    for (const pattern of codePatterns) {
      for (const m of excerpt.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))) {
        // An ordinary phrase like "s kodo Stopite v svet" is NOT a coupon.
        // Require a visibly uppercase/digit code, and reject language words.
        const raw = m[1], upper = raw.toUpperCase();
        if (raw !== upper || /^(?:POPUST|KODA|PROMO|CENA|IZDELEK|ARTIKEL|ZALOGI|UPORABI|DOSTAVA|CENE)$/i.test(raw)) continue;
        result.promoCode = upper;
        break;
      }
      if (result.promoCode) break;
    }
    // Public percentage discount is not necessarily the actual basket price.
    // Show the rate separately, not an invented amount (terms/minimum baskets may apply).
    if (result.promoCode) {
      const near = excerpt.match(/(?:PROMO\s*KODA|\b\d{1,2}\s*%\s*popusta\s*s\s*kodo)[^\n]{0,130}/i)?.[0] || excerpt;
      const percentage = near.match(/(?:PROMO\s*KODA[^\n]{0,30}?[–-]\s*|\b)(\d{1,2})\s*%\s*popusta\s*s\s*kodo\s+[A-Z0-9-]{4,28}/i);
      if (percentage && Number(percentage[1]) > 0) result.promoPercent = Number(percentage[1]);
    }
    // A product may have a normal price plus a cheaper price after entering a code.
    if (result.promoPrice != null && result.price === result.promoPrice) {
      const bigger = euros.filter(x => x.value > result.promoPrice).at(-1);
      if (bigger) result.price = bigger.value;
    }
    if (result.promoPrice != null && result.price != null && result.promoPrice >= result.price) result.promoPrice = null;
  }
  function exactEuro(el) {
    if (!el) return null;
    const direct = clean(el.getAttribute('content') || el.getAttribute('data-price') || el.textContent, 110);
    // Never parse a container with multiple prices or a promotion description.
    if (direct.length > 55 || (direct.match(/€/g) || []).length > 1) return null;
    const match = direct.match(/^(?:\s*(?:Cena|Spletna cena|Akcijska cena)\s*:?\s*)?([\d.,\u00a0\u202f ]+)\s*(?:€|EUR)?\s*$/i);
    if (!match) return null;
    const val = parseMoney(match[1]);
    return val !== null && val > 0 ? val : null;
  }
  function primaryPriceNodes(doc) {
    const roots = [...doc.querySelectorAll('main [data-testid*="price"], main [data-test*="price"], main [class*="currentPrice"], main [class*="CurrentPrice"], main [class*="price-current"], main [itemprop="price"]')].slice(0, 40);
    return roots.map(el => ({price:exactEuro(el), el})).filter(x => x.price !== null);
  }
  function repairPricing(doc, result, visibleText) {
    const nearby = (visibleText || pageText(doc));
    const titleAt = nearby.toLowerCase().indexOf(result.title.toLowerCase().slice(0,65));
    const excerpt = nearby.slice(Math.max(0,titleAt), Math.max(0,titleAt)+1850);
    const prices = allEuros(excerpt).filter(x => {
      const before = excerpt.slice(Math.max(0,x.at-45),x.at);
      const after = excerpt.slice(x.at + x.raw.length,x.at + x.raw.length + 12);
      return !/(?:prihranite|dostava|poštnina|darilo|donirali)\s*:?\s*$/i.test(before)
        && !/^\s*s\s*kodo\b/i.test(after)
        && !/(?:cena\s+s\s+kodo|s kodo)\s*:?\s*$/i.test(before);
    }).map(x=>x.value);
    const primaryNodes = primaryPriceNodes(doc).map(x=>x.price);
    const candidates = [...primaryNodes,...prices].filter(p=>p>0);
    if (result.price == null && result.promoPrice != null) {
      const likely = candidates.filter(p => p > result.promoPrice && p <= result.promoPrice*2.7);
      if (likely.length) {
        // The lowest verified ordinary price above the coupon price is more
        // likely to be the current price than a reference/previous price.
        result.price = Math.min(...likely);
        result.priceWarning = 'Trenutna cena določena iz cenovnega dela izdelka.';
      }
    }
    if (result.promoPrice != null) {
      // Explicit coupon price is an independent anchor. Prices tens of times
      // higher than this are almost always merged dates or unrelated offers.
      const sensible = candidates.filter(p=>p>result.promoPrice && p<=result.promoPrice*2.7);
      if (result.price != null && (result.price <= result.promoPrice || result.price>result.promoPrice*2.7)) {
        result.price = sensible.length ? sensible[0] : null;
        result.priceWarning = sensible.length ? 'Popravljena nepravilno prebrana cena.' : 'Trenutna cena ni zanesljivo določena.';
      }
      if (result.oldPrice != null && result.oldPrice > (result.price || result.promoPrice)*3) result.oldPrice=null;
    }
    // Prefer a precise price tag over an outlier extracted from a text blob.
    if (primaryNodes.length && result.price != null && primaryNodes.every(p=>Math.abs(p-result.price)>0.01)) {
      const target = primaryNodes.find(p=>result.promoPrice==null || p>=result.promoPrice);
      if (target && (result.price > target*3 || target>result.price*3)) {
        result.price = target;
        result.priceWarning = 'Cena preverjena v označenem cenovnem polju.';
      }
    }
    if (result.oldPrice !== null && (result.price === null || result.oldPrice <= result.price || result.oldPrice > result.price*5)) result.oldPrice=null;
    if (result.promoPrice !== null && result.price != null && result.promoPrice >= result.price) result.promoPrice=null;
  }
  function parseProduct(html, url, visibleText = '') {
    const valid = cleanURL(url); if (!valid) throw new Error('Neveljaven naslov artikla.');
    const doc = getDoc(html);
    const structured = [];
    for (const s of [...doc.querySelectorAll('script[type="application/ld+json"]')].slice(0, 20)) {
      try { structured.push(...jsonProducts(JSON.parse(s.textContent))); } catch (_) { /* invalid JSON-LD */ }
    }
    const mainTitle = selectText(doc.querySelector('h1'));
    const product = structured.find(p => {
      const productURL = p.url || p['@id'];
      try { return productURL && cleanURL(new URL(productURL, valid).href) === valid; } catch (_) { return false; }
    }) || structured.find(p => mainTitle && clean(p.name).toLowerCase() === mainTitle.toLowerCase()) || null;
    const result = { url: valid, id: idFromURL(valid), identifiers: [], pageIdentifiers: [], title: '', description: '', image: '', images: [], brand: '', price: null, oldPrice: null, promoCode: '', promoPrice: null, promoPercent: null, priceWarning: '', specs: {} };
    if (result.id) result.identifiers.push(result.id);
    if (product) {
      result.title = clean(product.name, 250);
      result.description = clean(product.description, 2500).replace(/<[^>]+>/g, ' ');
      result.brand = clean(typeof product.brand === 'object' ? product.brand?.name : product.brand, 90);
      result.pageIdentifiers.push(...jsonIdentifiers(product));
      result.identifiers.push(...jsonIdentifiers(product));
      const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
      const offer = offers.find(o => o && typeof o === 'object' && (!o.priceCurrency || String(o.priceCurrency).toUpperCase() === 'EUR'));
      if (offer) {
        result.price = parseMoney(offer.price ?? offer.lowPrice);
        let specs = offer.priceSpecification || [];
        if (!Array.isArray(specs)) specs = [specs];
        if (result.price === null) result.price = parseMoney(specs.find(x => /SalePrice/i.test(x?.priceType || ''))?.price);
        for (const entry of specs) {
          if (!entry || typeof entry !== 'object') continue;
          if (/ListPrice|StrikethroughPrice|RegularPrice|OriginalPrice/i.test(entry.priceType || '')) {
            const candidate = parseMoney(entry.price);
            if (candidate !== null && result.price !== null && candidate > result.price) result.oldPrice = candidate;
          }
        }
      }
      for (const prop of Array.isArray(product.additionalProperty) ? product.additionalProperty : [product.additionalProperty]) {
        if (prop && typeof prop === 'object') specAdd(result.specs, prop.name, prop.value);
      }
    }
    result.title ||= metaContent(doc, 'og:title', 'twitter:title') || selectText(doc.querySelector('h1'));
    result.description ||= metaContent(doc, 'og:description', 'description');
    result.images = getPictures(doc, product, valid, result.title);
    result.image = result.images[0] || '';
    if (!result.brand) result.brand = clean(doc.querySelector('[itemprop="brand"]')?.getAttribute('content') || '', 90);
    if (result.price === null) {
      for (const name of ['product:price:amount','og:price:amount','product:price','price']) {
        const price = parseMoney(metaContent(doc, name)); if (price !== null) { result.price = price; break; }
      }
    }
    if (result.price === null) {
      for (const selector of ['[itemprop="price"][content]','[data-testid="product-price"]','main [data-testid="price"]','main [class*="current-price"]']) {
        const e = doc.querySelector(selector); if (!e) continue;
        const price = parseMoney(e.getAttribute('content') || selectText(e));
        if (price !== null) { result.price = price; break; }
      }
    }
    if (result.price !== null && result.oldPrice === null) {
      for (const name of ['product:original_price:amount','product:regular_price:amount','original-price']) {
        const p = parseMoney(metaContent(doc, name)); if (p !== null && p > result.price) { result.oldPrice = p; break; }
      }
    }
    if (result.price !== null && result.oldPrice === null) {
      const root = doc.querySelector('main') || doc.querySelector('article') || doc.body;
      const selectors = ['[data-testid="old-price"]','[class*="original-price"]','[class*="old-price"]','[class*="oldPrice"]','del','s'];
      for (const selector of selectors) {
        const candidates = [...root.querySelectorAll(selector)].slice(0, 8);
        const p = candidates.map(e => parseMoney(selectText(e))).find(n => n !== null && n > result.price && n < result.price * 10);
        if (p !== undefined) { result.oldPrice = p; break; }
      }
    }
    readOfferArea(doc, result.title, result, visibleText);
    repairPricing(doc, result, visibleText);
    // Additional photo fallback: product images are often outside CSS gallery blocks.
    if (!result.images.length) {
      const extra = [];
      const target = doc.querySelector('main') || doc.body;
      for (const img of [...target.querySelectorAll('img')].slice(0, 75)) {
        const alt = clean(img.getAttribute('alt') || '').toLowerCase();
        const name = clean(result.title).toLowerCase();
        const src = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('src');
        if (!src || !alt || !(name.includes(alt.slice(0, 20)) || alt.includes(name.slice(0, 20)))) continue;
        const image = safeImage(src, valid); if (image && !extra.includes(image)) extra.push(image);
      }
      result.images = extra.slice(0, 10); result.image = result.images[0] || '';
    }
    const regions = doc.querySelectorAll('main section[id*="spec"], main section[class*="spec"], main section[id*="param"], main section[class*="technical"], main [data-testid*="spec"], main table, article table');
    for (const r of regions) {
      for (const tr of r.querySelectorAll('tr')) {
        const cells = [...tr.children].filter(x => ['TH','TD'].includes(x.tagName));
        if (cells.length === 2) specAdd(result.specs, selectText(cells[0]), selectText(cells[1]));
      }
      for (const dt of r.querySelectorAll('dt')) {
        const next = dt.nextElementSibling; if (next?.tagName === 'DD') specAdd(result.specs, selectText(dt), selectText(next));
      }
      for (const li of r.querySelectorAll('li')) {
        const m = selectText(li).match(/^([^:]{3,70}):\s*(.{1,220})$/);
        if (m) specAdd(result.specs, m[1], m[2]);
      }
    }
    if (Object.keys(result.specs).length < 4) {
      for (const li of doc.querySelectorAll('main li, article li')) {
        const m = selectText(li).match(/^([^:]{3,60}):\s*(.{1,160})$/);
        if (m) specAdd(result.specs, m[1], m[2]);
        if (Object.keys(result.specs).length >= 24) break;
      }
    }
    // Product pages commonly label their actual item ID "Številka: 53242197".
    // Older versions only recognized "ID" and missed valid products whose URL
    // has no numeric suffix. Read the main product content, not site-wide search
    // snippets. The page must explicitly LABEL the number to count as proof.
    function onPageIdentifiers(root) {
      const out = [];
      const productText = selectText(root).slice(0, 25000);
      const pattern = /(?:Številka(?:\s+(?:artikla|izdelka))?|ID(?:\s+izdelka)?)\s*[:#]?\s*(\d{4,18})(?!\d)/giu;
      for (const m of productText.matchAll(pattern)) {
        const context = productText.slice(Math.max(0, m.index - 25), m.index);
        // Exclude unrelated company/account/phone identifiers.
        if (/(?:matična|davčna|telefonska|naročila|računa|sledenja)\s*$/iu.test(context)) continue;
        out.push(m[1]);
        if (out.length >= 20) break;
      }
      return out;
    }
    result.pageIdentifiers.push(...onPageIdentifiers(doc.querySelector('main') || doc.body));
    result.identifiers.push(...onPageIdentifiers(doc.querySelector('main') || doc.body));
    // Some templates render the product number just outside <main>.
    if (result.identifiers.length < 2 && doc.querySelector('main')) {
      result.pageIdentifiers.push(...onPageIdentifiers(doc.body));
      result.identifiers.push(...onPageIdentifiers(doc.body));
    }
    for (const el of [...doc.querySelectorAll('[data-product-id], [data-productid], [data-sku]')].slice(0, 25)) {
      for (const attr of ['data-product-id','data-productid','data-sku']) {
        const id = el.getAttribute(attr); if (ID_RE.test(id || '')) { result.identifiers.push(id); result.pageIdentifiers.push(id); }
      }
    }
    for (const key of ['sku','productID','gtin13']) {
      const value = metaContent(doc, 'product:'+key, key);
      if (ID_RE.test(value)) { result.identifiers.push(value); result.pageIdentifiers.push(value); }
    }
    result.identifiers = [...new Set(result.identifiers)];
    result.pageIdentifiers = [...new Set(result.pageIdentifiers)];
    if (result.oldPrice !== null && (result.price === null || result.oldPrice <= result.price)) result.oldPrice = null;
    // The URL must look like a product or the page must carry Product JSON-LD.
    // Never turn a category/consent/search page into an apparent product.
    if (!result.title || (!product && !doc.querySelector('h1'))) {
      throw new Error('Izdelek na strani ni bil prepoznan (morda preusmeritev ali zaščita strani).');
    }
    return result;
  }
  function matchesPageID(product, sought) { return ID_RE.test(String(sought)) && (product?.pageIdentifiers || []).includes(String(sought)); }
  function matchesID(product, sought) { return ID_RE.test(String(sought)) && (product?.identifiers || [product?.id]).includes(String(sought)); }
  scope.MimoParser = Object.freeze({ cleanURL, idFromURL, splitEntries, parseMoney, parseProduct, resolveID, searchCandidates, matchesID, matchesPageID, searchURL, searchURLs, directIDURL, BASE });
})(typeof globalThis !== 'undefined' ? globalThis : this);
