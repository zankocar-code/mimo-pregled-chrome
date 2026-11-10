/* Public search-index discovery. Search results are untrusted candidates, never a product match. */
(function (scope) {
  'use strict';
  const P = scope.MimoParser;
  const exact = id => /^\d{4,18}$/.test(String(id || ''));
  const SOURCE = [
    {name:'Bing', url: id => 'https://www.bing.com/search?q=' + encodeURIComponent('site:mimovrste.com "' + id + '"')},
    {name:'DuckDuckGo', url: id => 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent('site:mimovrste.com "' + id + '"')},
    {name:'Google', url: id => 'https://www.google.com/search?q=' + encodeURIComponent('site:mimovrste.com "' + id + '"')}
  ];
  // Verified by a public Mimovrste listing. The mapping is only a page pointer,
  // NEVER a cache of title/photo/price. Validate the page again on refresh.
  const VERIFIED_LINKS = Object.freeze({
    '53242197': {url: 'https://www.mimovrste.com/espresso-kavni-aparati/delonghi-eletta-ultra-ecam47085mb-kavni-aparat-avtomatski', namePattern: /eletta\s+ultra.*ecam\s*470[.,]?85/i},
    // Identified by the exact 'Številka: 41174608' public Google search excerpt.
    // This is an indexed association, not an ID independently read from the current product HTML.
    '41174608': {url: 'https://www.mimovrste.com/espresso-kavni-aparati/delonghi-rivelia-kavni-aparat-siv-exam44055g', namePattern: /rivelia.*exam\s*440[.,]?55/i},
    // Item IDs and product titles were confirmed in the user's Firefox catalogue screenshot.
    // These are fallback page pointers; current prices always come from Mimovrste.
    '54247780': {url:'https://www.mimovrste.com/susilni-stroji/gorenje-dg48c-susilni-stroj-8-kg',namePattern:/gorenje.*dg48c/i},
    '54247782': {url:'https://www.mimovrste.com/susilni-stroji/gorenje-dg49cp-susilni-stroj-9-kg',namePattern:/gorenje.*dg49cp/i}
  });
  function unwrap(href, base) {
    if (!href) return null;
    try {
      const u = new URL(href, base);
      if (u.hostname === 'www.google.com' && u.pathname === '/url') {
        return P.cleanURL(u.searchParams.get('q') || u.searchParams.get('url'));
      }
      if (u.hostname.endsWith('duckduckgo.com') && u.pathname.includes('/l/')) {
        return P.cleanURL(u.searchParams.get('uddg'));
      }
      return P.cleanURL(u.href);
    } catch (_) {return null;}
  }
  function candidates(html, sourceUrl, id) {
    if (!exact(id) || typeof DOMParser === 'undefined') return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const matches = new Map();
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = unwrap(a.getAttribute('href'), sourceUrl);
      if (!href) continue;
      const result = a.closest('li.b_algo, .result, .MjjYud, .g, [data-snf], [data-hveid]');
      const headline = a.querySelector('h3') || a.closest('h3');
      if (!result && !headline && !a.classList.contains('result__a')) continue;
      const title = (headline?.textContent || a.textContent || '').replace(/\s+/g, ' ').trim();
      if (title.length < 8 || !href) continue;
      const context = (result || a.closest('div') || a).textContent || '';
      const score = 10 + (result ? 5 : 0) + (new RegExp('(^|\\D)' + id + '(\\D|$)').test(context) ? 50 : 0);
      const labeled = new RegExp('(?:Številka(?:\\s+artikla)?|ID\\s+(?:artikla|izdelka)|SKU)\\s*[:#]?\\s*' + id + '(?!\\d)', 'i').test(context);
      if (!matches.has(href) || matches.get(href).score < score) matches.set(href, {url:href,score,source:sourceUrl,indexTitle:title,indexProof:labeled});
    }
    // Some Google/DDG result links are embedded in HTML but not DOM anchors.
    // Keep fallback restrictive: only exact Mimovrste product-like URLs, no search/category.
    if (!matches.size) {
      const normalized = html.replace(/\\u002f/ig,'/').replace(/\\\//g,'/');
      const regex = /https?:\/\/(?:www\.)?mimovrste\.com\/[\w%.-]+\/[\w%.-]+/g;
      for (const m of normalized.matchAll(regex)) {
        const url = P.cleanURL(m[0]);
        if (url && /\/[\w-]+\/[\w-]*-[\w-]+$/.test(url)) matches.set(url,{url,score:1,source:sourceUrl});
        if (matches.size >= 8) break;
      }
    }
    return [...matches.values()].sort((a,b)=>b.score-a.score).slice(0,8);
  }
  scope.MimoDiscovery = Object.freeze({SOURCE, VERIFIED_LINKS, candidates, unwrap});
})(globalThis);
