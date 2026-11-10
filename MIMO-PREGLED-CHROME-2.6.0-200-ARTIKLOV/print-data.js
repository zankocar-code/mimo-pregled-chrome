/* Mimo Pregled 2.6 – price-safe print data helpers; no external dependencies. */
'use strict';
(function (global) {
  const isPrice = n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1e8;
  const asPrice = v => {
    if (typeof v === 'number') return isPrice(v) ? v : null;
    if (typeof v !== 'string' || !/^\s*\d{1,8}(?:[.,]\d{1,2})?\s*$/.test(v)) return null;
    const n = Number(v.trim().replace(',', '.'));
    return isPrice(n) ? n : null;
  };
  const effective = row => {
    const d = {...(row.data || {}), ...(row.overrides || {})};
    d.price = asPrice(d.price);
    d.oldPrice = asPrice(d.oldPrice);
    d.promoPrice = asPrice(d.promoPrice);
    // Reuse the same safeguard as the main catalog for historical bad parsing.
    if (d.price != null && d.promoPrice != null && d.price > d.promoPrice * 2.7) {
      d.price = null; d.oldPrice = null;
      d.priceWarning = 'Sumljivo visoka cena – osveži artikel.';
    }
    // A discount must not be invented for contradictory values.
    d.discount = d.price != null && d.oldPrice > d.price ? Math.round((1-d.price/d.oldPrice)*100) : 0;
    d.hasCode = !!(typeof d.promoCode === 'string' && d.promoCode.trim());
    d.hasPromo = (d.promoPrice != null && (d.price == null || d.promoPrice < d.price)) ||
        d.hasCode;
    d.hasDiscount = d.discount > 0 || d.hasPromo;
    return d;
  };
  const prepare = (rows, scope, layout) => {
    const safeScope = ['all','discounts','sale','code'].includes(scope) ? scope : 'discounts';
    const safeLayout = layout === 'compact' ? 'compact' : 'list';
    const records = [];
    for (const row of Array.isArray(rows) ? rows.slice(0,200) : []) {
      if (!row || !row.key) continue;
      const d = effective(row);
      if (safeScope === 'discounts' && !d.hasDiscount) continue;
      if (safeScope === 'sale' && !d.discount) continue;
      if (safeScope === 'code' && !d.hasPromo) continue;
      const images = [d.image, ...(Array.isArray(d.images) ? d.images : [])]
        .filter(s => typeof s === 'string' && /^https:\/\//i.test(s) && s.length < 3000);
      records.push({
        key:String(row.key), id:String(row.id || '—'), title:String(d.title || `Artikel ${row.id || 'brez ID'}`),
        brand:String(d.brand || ''), imageURLs:[...new Set(images)].slice(0,5),
        price:d.price, oldPrice:d.oldPrice, promoPrice:d.promoPrice,
        promoPercent:Number.isFinite(Number(d.promoPercent)) ? Math.max(0,Math.min(99,Math.round(Number(d.promoPercent)))) : 0,
        promoCode:d.hasCode ? d.promoCode.trim().slice(0,80) : '',
        discount:d.discount, hasDiscount:d.hasDiscount, hasPromo:d.hasPromo,
        warning:String(row.error || row.warning || d.priceWarning || ''),
        verified: !!row.verified && !row.error,
        updated: Number.isFinite(Number(row.fetchedAt)) ? Number(row.fetchedAt) : 0,
        url:String(row.url || '')
      });
    }
    return {scope:safeScope,layout:safeLayout,records};
  };
  global.MimoPrintData={effective,prepare,asPrice};
})(globalThis);
