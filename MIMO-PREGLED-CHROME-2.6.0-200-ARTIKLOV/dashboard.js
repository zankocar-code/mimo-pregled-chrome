'use strict';
/* No analytics or remote scripts. User-supplied IDs are queried against public search providers only when on-site lookup has no proven URL. */
const P = MimoParser;
const D = MimoDiscovery;
const $ = id => document.getElementById(id);
let items = [], view = 'all', selectedKey = null, detailTab = 'spec', busy = false, stopRequested = false;
let toastTimer = null;
const euro = new Intl.NumberFormat('sl-SI', { style: 'currency', currency: 'EUR' });
const pct = d => d.price != null && d.oldPrice > d.price ? Math.round((1 - d.price / d.oldPrice) * 100) : 0;
const asNum = v => v === '' || v == null ? null : P.parseMoney(v);
const effective = row => {
  const d = { ...(row.data || {}), ...(row.overrides || {}) };
  // Old cached versions may contain a concatenated-year price (26.589,29 €).
  // Do not continue presenting that value as if it was verified.
  if (d.price != null && d.promoPrice > 0 && d.price > d.promoPrice * 2.7) {
    d.price = null; d.oldPrice = null;
    d.priceWarning = 'Stara cena je bila verjetno napačno razbrana. Osveži artikel.';
  }
  return d;
};
const node = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const BATCH_LIMIT = 200;
const CACHE_TTL_MS = 15 * 60 * 1000;
// At most four products are processed at the same time. Requests to Mimovrste
// are spaced to avoid an accidental burst even when several workers are active.
let requestGate = Promise.resolve(), nextSiteRequest = 0, siteCooldownUntil = 0;
let saveQueue = Promise.resolve();
let lastCheckpoint = 0;
async function sitePermit() {
  const previous = requestGate;
  let unlock;
  requestGate = new Promise(resolve => { unlock = resolve; });
  await previous;
  try {
    const now = Date.now();
    const scheduled = Math.max(now, nextSiteRequest, siteCooldownUntil);
    if (scheduled > now) await wait(scheduled - now);
    nextSiteRequest = Date.now() + 425;
  } finally { unlock(); }
}
function noticeRateLimit(status, response) {
  if (status !== 429 && status !== 503) return;
  // Never hammer the store when it asks us to slow down.
  const header = response.headers.get('retry-after') || '';
  const retrySeconds = /^\d+$/.test(header) ? Math.min(45, Number(header)) : 12;
  siteCooldownUntil = Math.max(siteCooldownUntil, Date.now() + Math.max(5000, retrySeconds * 1000));
}
async function checkpoint(force = false) {
  if (!force && Date.now() - lastCheckpoint < 1300) return;
  lastCheckpoint = Date.now();
  await save();
}

function notice(message, error = false) {
  const t = $('toast'); t.textContent = message; t.hidden = false; t.classList.toggle('error', error);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4900);
}
function save() {
  // Persist immutable snapshots in order, so concurrent workers cannot overwrite
  // a newer snapshot with an earlier one.
  const snapshot = structuredClone(items);
  const pending = saveQueue.then(() => chrome.storage.local.set({ products: snapshot }));
  saveQueue = pending.catch(() => {});
  return pending;
}
function setBusy(flag, label = '') {
  busy = flag; $('submitImport').disabled = flag;
  $('refreshBtn').disabled = flag; $('listRefreshBtn').disabled = flag;
  $('progressText').textContent = label;
  $('refreshBtn').innerHTML = flag ? '<span>↻</span> Osveževam …' : '<span>↻</span> Osveži cene';
}
function getEntryKey(entry) { return entry.id ? 'id:' + entry.id : 'url:' + entry.url; }
async function addEntries(entries) {
  let added = 0, existing = 0, limitSkipped = 0; const keys = [];
  for (const entry of entries) {
    const key = getEntryKey(entry);
    const matching = items.find(x => x.key === key || (!!entry.url && x.url === entry.url));
    if (matching) { if (entry.url) matching.url = entry.url; keys.push(matching.key); existing++; continue; }
    if (items.length >= BATCH_LIMIT) { limitSkipped++; continue; }
    items.unshift({ key, id: entry.id, url: entry.url, data: {}, overrides: {}, fetchedAt: 0, error: '', createdAt: Date.now() });
    keys.push(key); added++;
  }
  await save(); render();
  return { added, existing, limitSkipped, keys: [...new Set(keys)] };
}
async function getText(url) {
  await sitePermit();
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const response = await fetch(url, { signal: ctrl.signal, credentials: 'include', redirect: 'follow', headers: { 'Accept': 'text/html' } });
    noticeRateLimit(response.status, response);
    if (!response.ok) throw new Error('Spletna stran je vrnila napako ' + response.status + '.');
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/html|text\/plain/i.test(contentType)) throw new Error('Odgovor ni HTML-stran.');
    const resolved = P.cleanURL(response.url, true);
    if (!resolved) throw new Error('Stran je preusmerila na neveljaven naslov.');
    const body = await response.text();
    if (body.length < 300 || body.length > 6000000) throw new Error('Stran je prazna ali prevelika.');
    return { body, url: resolved };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Čas za prenos je potekel.');
    if (err instanceof TypeError) throw new Error('Strani ni mogoče prenesti. Preveri povezavo ali dovoljenja Chrome.');
    throw err;
  } finally { clearTimeout(timer); }
}
// Chrome fallback: open the real Mimovrste page in an inactive tab so its
// client-side search and product gallery scripts can render. The tab is closed
// after reading. This is not an API or a guarantee against site restrictions.
async function readRendered(url, searchId = '') {
  if (!chrome.scripting?.executeScript || !chrome.tabs?.create) throw new Error('Branje odprte strani ni dovoljeno.');
  await sitePermit();
  const tab = await chrome.tabs.create({url, active:false});
  try {
    let ready = false;
    for (let n = 0; n < 36 && !stopRequested; n++) {
      await wait(650);
      try { const current = await chrome.tabs.get(tab.id); if (current?.status === 'complete') { ready = true; break; } }
      catch (err) { throw new Error('Zavihek ni več dostopen.'); }
    }
    if (!ready) throw new Error('Mimovrste se ni pravočasno naložil.');
    await wait(searchId ? 1700 : 900);
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['parser.js']});
    if (searchId) {
      const output = await chrome.scripting.executeScript({target:{tabId:tab.id},
        func: id => ({url:location.href, candidates:globalThis.MimoParser.searchCandidates(document.documentElement.outerHTML,id)}),
        args:[searchId]});
      return output?.[0]?.result || null;
    }
    const output = await chrome.scripting.executeScript({target:{tabId:tab.id},files:['capture.js']});
    const record = output?.[0]?.result;
    if (record?.item) return {data:record.item,url:record.item.url};
    throw new Error(record?.error || 'Strani izdelka ni bilo mogoče prebrati.');
  } finally { try { await chrome.tabs.remove(tab.id); } catch (_) {} }
}
async function tryProduct(url) {
  let fetched = null, parsed = null, originalError = null;
  try {
    fetched = await getText(url);
    parsed = P.parseProduct(fetched.body, fetched.url);
  } catch (e) { originalError = e; }
  // A successful title is not enough: if JS produces photo and price only after
  // hydration, read the rendered tab as well.
  if (!parsed || parsed.price == null || !parsed.image || parsed.priceWarning ||
      (parsed.promoCode && parsed.promoPrice == null && parsed.promoPercent == null)) {
    try {
      const shown = await readRendered(url);
      if (shown?.data) {
        if (parsed) {
          // Prefer the rendered page, but retain any data it lacks.
          const live = shown.data;
          for (const key of ['price','oldPrice','promoPrice']) if (live[key] == null && !parsed.priceWarning) live[key] = parsed[key];
          for (const key of ['image','description','title','brand','promoCode']) if (!live[key]) live[key] = parsed[key];
          if (!(live.images?.length)) live.images = parsed.images;
          live.identifiers = [...new Set([...(live.identifiers || []), ...(parsed.identifiers || [])])];
          if (!Object.keys(live.specs || {}).length) live.specs = parsed.specs;
          return {data:live,url:shown.url};
        }
        return shown;
      }
    } catch (e) { if (!parsed) originalError = e; }
  }
  if (parsed) return {data:parsed,url:fetched.url};
  throw originalError || new Error('Ni bilo mogoče pridobiti strani izdelka.');
}
// Read a public search result page as a discovery source, not as product data.
async function getSearchHTML(url) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const response = await fetch(url, {signal:ctrl.signal,credentials:'omit',redirect:'follow'});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const final = new URL(response.url);
    if (!['www.google.com','www.bing.com','html.duckduckgo.com'].includes(final.hostname)) throw new Error('Preusmeritev na ' + final.hostname);
    const body = await response.text();
    if (body.length > 2500000 || body.length < 150) throw new Error('Nepričakovana velikost odgovora');
    return {body, url:response.url};
  } finally {clearTimeout(timer);}
}
// If remote search HTML is a consent page or blocked, load the public search
// as a normal Chrome tab and inspect the DOM that Chrome actually rendered.
// This is intentionally slower than fetch, but does not require an API or proxy.
async function readRenderedIndex(provider, id) {
  if (!chrome.scripting?.executeScript || !chrome.tabs?.create) return [];
  const searchUrl = provider.url(id);
  const tab = await chrome.tabs.create({url:searchUrl,active:false});
  try {
    let ready=false;
    for (let t=0;t<23 && !stopRequested;t++) {
      await wait(550);
      const current=await chrome.tabs.get(tab.id);
      if (current.status === 'complete') {ready=true;break;}
    }
    if (!ready) return [];
    await wait(1000);
    const output=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({
      html:document.documentElement.outerHTML.slice(0,1_800_000),
      url:location.href,
      text:(document.body?.innerText||'').slice(0,9000)
    })});
    const page=output?.[0]?.result;
    if (!page || /(?:captcha|unusual traffic|preverite, da niste robot|verify you are human)/i.test(page.text||'')) return [];
    return D.candidates(page.html,page.url,id).map(c=>({...c,source:provider.name+' (zavihek)'}));
  } catch (_) {return [];} finally {try {await chrome.tabs.remove(tab.id);}catch(_) {}}
}
async function findCandidates(id) {
  const candidates = [], diagnostics = [], seen = new Set();
  const add = (list, source) => {
    for (const c of list || []) {
      const url = P.cleanURL(c.url);
      if (!url || seen.has(url)) continue;
      seen.add(url); candidates.push({...c,url,source:c.source || source});
    }
  };
  // A known link is just a hint: the product must still match its known name.
  const known = D.VERIFIED_LINKS[id];
  if (known) {
    add([{url:known.url,source:'Prej potrjena povezava'}]);
    return {candidates, diagnostics};
  }
  // 1. The user's requested historic /iskanje?s=ID route first.
  // 2. Mimovrste's newer /iskanje?q=ID route immediately afterwards.
  for (const url of P.searchURLs(id)) {
    if (stopRequested || candidates.length >= 7) break;
    try {
      const search = await getText(url);
      if (P.idFromURL(search.url) === id) add([{url:search.url,exactURL:true}],'Mimovrste (preusmeritev)');
      add(P.searchCandidates(search.body,id), 'Mimovrste (' + new URL(url).search + ')');
    } catch (e) { diagnostics.push(new URL(url).search + ': ' + String(e.message || e).slice(0,80)); }
    if (candidates.length) break;
  }
  // Some site results are only present after client-side JavaScript hydration.
  if (!candidates.length && !stopRequested) {
    for (const url of P.searchURLs(id)) {
      try {
        const shown=await readRendered(url,id);
        if (P.idFromURL(shown?.url) === id) add([{url:shown.url,exactURL:true}],'Mimovrste (naložena stran)');
        add(shown?.candidates,'Mimovrste (naložena stran)');
      } catch(e) {diagnostics.push('Naloženo '+new URL(url).search+': '+String(e.message||e).slice(0,65));}
      if (candidates.length || stopRequested) break;
    }
  }
  // Direct numeric URL is speculative: never automatically accept its content
  // without exact labeled ID proof. No external domain or third-party proxy.
  if (!candidates.length && !stopRequested) {
    const direct = P.directIDURL(id);
    try {
      const response = await getText(direct);
      if (!/\/iskanje\?/.test(response.url) && P.idFromURL(response.url) === id) {
        add([{url:response.url,exactURL:true}], 'Neposredni ID');
      } else if (response.url !== direct && !response.url.includes('/iskanje')) {
        const p=P.parseProduct(response.body,response.url);
        if (P.matchesPageID(p,id)) add([{url:response.url,exactURL:true}],'Neposredni ID (preusmeritev)');
      }
    } catch (e) {diagnostics.push('Neposredni ID: '+String(e.message||e).slice(0,60));}
  }
  // Only when Mimovrste has no candidates, use public indexes as a LAST resort.
  if (!candidates.length && !stopRequested) {
    for (const provider of D.SOURCE) {
      if (stopRequested) break;
      try {
        const page=await getSearchHTML(provider.url(id));
        const matched=D.candidates(page.body,page.url,id);
        add(matched,provider.name);
        if (matched.length) break;
      } catch(e) {diagnostics.push(provider.name+': '+String(e.message||e).slice(0,65));}
    }
  }
  if (!candidates.length && !stopRequested) {
    for (const provider of [D.SOURCE[2],D.SOURCE[0]]) {
      const shown=await readRenderedIndex(provider,id);
      add(shown,provider.name+' (zavihek)');
      if (shown.length || stopRequested) break;
    }
  }
  return {candidates:candidates.slice(0,12),diagnostics};
}
function linkedIDVerified(item, id, url, candidate = null) {
  const known = D.VERIFIED_LINKS[id];
  if (known && P.cleanURL(known.url) === P.cleanURL(url) && known.namePattern.test(item.title || '')) return true;
  if (!candidate?.indexProof || P.cleanURL(url) !== candidate.url) return false;
  // Another index may contain the exact labeled ID. Only accept that evidence
  // when the linked Mimovrste product still has a closely matching name.
  const normalize = s => String(s || '').toLocaleLowerCase('sl').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\|.*$/,'').replace(/[^a-z0-9]+/g,' ').trim();
  const indexed = normalize(candidate.indexTitle).split(' ').filter(t => t.length > 3).slice(0,8);
  const page = normalize(item.title);
  return indexed.length >= 3 && indexed.filter(word => page.includes(word)).length >= Math.ceil(indexed.length * .85);
}
async function refreshOne(row) {
  try {
    let data = null, finalURL = null, verified = false, proof = '', directError = '';
    // A previously cached URL can be stale or point to the wrong product.
    // If it fails, search by ID again instead of trusting the old URL.
    if (row.url) {
      try {
        const outcome = await tryProduct(row.url);
        if (row.id && !P.matchesID(outcome.data, row.id) && !linkedIDVerified(outcome.data, row.id, outcome.url)) {
          throw new Error(`Stran ne potrjuje ID-ja ${row.id}.`);
        }
        data = outcome.data; finalURL = outcome.url; verified = !!row.id;
        proof = P.matchesID(outcome.data, row.id) ? 'stran' : 'javni indeks';
      } catch (e) {
        directError = String(e?.message || e);
        if (!row.id) throw e;
      }
    }
    if (!data && row.id) {
      const found = await findCandidates(row.id);
      if (!found.candidates.length) throw new Error(`ID ${row.id}: ni javnih zadetkov. ${found.diagnostics.join(' / ').slice(0,160) || 'Poskusi s povezavo.'}`);
      let lastError = '';
      for (const candidate of found.candidates) {
        if (stopRequested) break;
        try {
          const outcome = await tryProduct(candidate.url);
          if (P.matchesID(outcome.data, row.id) || linkedIDVerified(outcome.data, row.id, outcome.url, candidate)) {
            data = outcome.data; finalURL = outcome.url; verified = true;
            proof = P.matchesID(outcome.data, row.id) ? 'stran' : 'javni indeks'; break;
          }
          lastError = 'Povezava ni potrdila ID-ja (' + (candidate.source || 'neznan vir') + ').';
        } catch (e) { lastError = String(e.message || e); }
        await wait(250);
      }
      if (!data) throw new Error(`ID ${row.id}: ni potrjenega ujemanja. ${lastError ? lastError.slice(0, 100) : 'Prilepi celotno povezavo, če jo poznaš.'}`);
    }
    if (!data) throw new Error('Manjka ID ali povezava.');
    row.data = data;
    row.url = finalURL;
    if (!row.id && data.id) row.id = data.id;
    row.verified = verified;
    row.verificationSource = proof;
    row.warning = [!data.image && 'fotografija ni bila najdena',data.price == null && 'cena ni bila najdena',data.priceWarning].filter(Boolean).join(' · ');
    row.error = '';
    row.fetchedAt = Date.now();
  } catch (e) {
    row.verified = false;
    row.verificationSource = '';
    row.warning = '';
    row.error = String(e?.message || 'Podatkov ni bilo mogoče pridobiti.').slice(0,250);
    row.fetchedAt = Date.now();
  }
}

async function refreshRows(keys) {
  if (busy) { notice('Počakaj, da se zaključi trenutno osveževanje.'); return; }
  const list = [...new Set(keys)].slice(0, BATCH_LIMIT).map(k => items.find(x => x.key === k)).filter(Boolean);
  if (!list.length) { notice('Ni artiklov za osvežitev.'); return; }
  stopRequested = false;
  const workerCount = Math.min(Math.max(Number($('workerCount').value) || 3, 1), 4, list.length);
  const cacheEnabled = $('cacheRecent').checked;
  const started = Date.now();
  let nextIndex = 0, done = 0, failed = 0, cached = 0;
  setBusy(true, `Začenjam iskanje ${list.length} izdelkov …`);
  $('workerCount').disabled = true;
  $('cacheRecent').disabled = true;
  $('stopBtn').hidden = false;
  const progress = () => {
    const inProgress = Math.max(0, Math.min(workerCount, nextIndex - done));
    $('progressText').textContent = `Obdelano ${done}/${list.length} · hkrati ${inProgress} · brez podatkov ${failed}${cached ? ` · iz predpomnilnika ${cached}` : ''}`;
  };
  async function worker() {
    for (;;) {
      if (stopRequested) break;
      const index = nextIndex++;
      if (index >= list.length) break;
      const row = list[index];
      const isRecent = cacheEnabled && row.verified && !row.error && row.data?.title &&
        Date.now() - (row.fetchedAt || 0) < CACHE_TTL_MS;
      try {
        if (isRecent) cached++;
        else await refreshOne(row);
        if (row.error) failed++;
      } catch (e) {
        row.error = String(e?.message || e).slice(0,250);
        failed++;
      } finally {
        done++;
        progress();
        // Update data in small checkpoints, not 200 full catalog writes / rerenders.
        try { await checkpoint(); } catch (e) { console.warn('Mimo Pregled: shramba', e); }
        if (Date.now() - (render.lastBatchRender || 0) > 900) {
          render.lastBatchRender = Date.now();
          render();
        }
      }
    }
  }
  try {
    progress();
    await Promise.all(Array.from({length:workerCount}, () => worker()));
    await checkpoint(true);
    const seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
    notice(`${stopRequested ? 'Ustavljeno' : 'Končano'}: ${done}/${list.length} izdelkov v ${seconds} s${cached ? ` · ${cached} iz predpomnilnika` : ''}${failed ? ` · ${failed} brez podatkov` : ''}.`, failed > 0);
  } finally {
    $('stopBtn').hidden = true;
    $('workerCount').disabled = false;
    $('cacheRecent').disabled = false;
    stopRequested = false;
    setBusy(false);
    render();
  }
}
function render() {
  const sale = items.filter(x => pct(effective(x)) > 0).length;
  const prepared = items.filter(x => effective(x).title || effective(x).price != null).length;
  const best = items.reduce((acc, i) => Math.max(acc, pct(effective(i))), 0);
  $('statAll').textContent = items.length;
  $('statSale').textContent = sale;
  $('statReady').textContent = prepared;
  $('statBest').textContent = best ? `${best} %` : '—';
  $('navCount').textContent = items.length;
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  const query = $('searchInput').value.trim().toLocaleLowerCase('sl');
  const shown = items.filter(row => {
    const d = effective(row);
    if (view === 'sale' && pct(d) <= 0) return false;
    if (view === 'missing' && !row.error && (d.title || d.price != null)) return false;
    const haystack = [row.id, row.url, d.title, d.brand, d.description].join(' ').toLocaleLowerCase('sl');
    return haystack.includes(query);
  });
  switch ($('sortSelect').value) {
    case 'priceAsc': shown.sort((a, b) => (effective(a).price ?? Infinity) - (effective(b).price ?? Infinity)); break;
    case 'priceDesc': shown.sort((a, b) => (effective(b).price ?? -1) - (effective(a).price ?? -1)); break;
    case 'discount': shown.sort((a, b) => pct(effective(b)) - pct(effective(a))); break;
    case 'title': shown.sort((a, b) => (effective(a).title || '').localeCompare(effective(b).title || '', 'sl')); break;
    default: shown.sort((a, b) => b.createdAt - a.createdAt);
  }
  $('visibleCount').textContent = `(${shown.length})`;
  const grid = $('itemsGrid'); grid.replaceChildren();
  for (const row of shown) grid.appendChild(makeCard(row));
  const isEmpty = shown.length === 0;
  $('emptyState').hidden = !isEmpty;
  if (isEmpty) {
    $('emptyTitle').textContent = items.length ? 'Ni zadetkov' : 'Tukaj bo tvoj katalog';
    $('emptyHint').textContent = items.length ? 'Spremeni iskanje ali izberi drugo kategorijo.' : 'Prilepi ID-je ali povezave do izdelkov z Mimovrste.';
    $('emptyImportBtn').hidden = !!items.length;
  }
}
function makeCard(row) {
  const d = effective(row), discounted = pct(d), card = node('article', 'product-card');
  const media = node('div', 'product-media');
  const candidates = [...new Set([d.image, ...(d.images || [])].filter(src => /^https:\/\//i.test(src || '')))];
  if (candidates.length) {
    const im = node('img', 'product-image'); im.alt = d.title || 'Fotografija izdelka'; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer';
    let attempt = 0;
    im.addEventListener('error', () => {
      attempt++;
      if (attempt < candidates.length) im.src = candidates[attempt];
      else { im.remove(); media.appendChild(node('span', 'media-placeholder', '▧')); }
    });
    im.src = candidates[0]; media.appendChild(im);
  } else media.appendChild(node('span', 'media-placeholder', '▧'));
  if (discounted) media.appendChild(node('span', 'discount-badge', `−${discounted} %`));
  if (row.error) media.appendChild(node('span', 'error-badge', 'Preveri ID'));
  const remove = node('button', 'product-remove', '×'); remove.type = 'button'; remove.title = 'Odstrani izdelek'; remove.setAttribute('aria-label', 'Odstrani izdelek');
  remove.addEventListener('click', async () => {
    if (!confirm('Želiš odstraniti ta izdelek iz svojega kataloga?')) return;
    items = items.filter(x => x.key !== row.key); await save(); render(); notice('Artikel je odstranjen.');
  }); media.appendChild(remove); card.appendChild(media);
  const content = node('div', 'product-content');
  content.appendChild(node('div', 'product-brand', d.brand || 'MIMOVRSTE'));
  content.appendChild(node('h3', 'product-title', d.title || `Artikel ${row.id || 'brez imena'}`));
  content.appendChild(node('div', 'product-id', `ID: ${row.id || '—'}`));
  if (row.verified && !row.error) content.appendChild(node('div', 'verified-id', row.verificationSource === 'stran' ? '✓ ID preverjen na strani izdelka' : '✓ ID preverjen v javnem indeksu'));
  if ((row.warning || d.priceWarning) && !row.error) content.appendChild(node('div', 'product-issue', 'Opomba: ' + [row.warning,d.priceWarning].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' · ')));
  if (row.error) content.appendChild(node('div', 'product-issue', row.error));
  const desc = node('p', 'product-description', d.description || (row.error ? row.error : 'Opis izdelka trenutno ni na voljo.'));
  content.appendChild(desc);
  const bottom = node('div', 'product-bottom');
  const priceInfo = node('div', 'product-price-info');
  priceInfo.appendChild(node('div', 'price-label', discounted ? 'AKCIJSKA CENA' : 'CENA NA MIMOVRSTE'));
  priceInfo.appendChild(node('strong', 'product-price', d.price != null ? euro.format(d.price) : 'Cena ni na voljo'));
  if (discounted) {
    const old = node('div', 'previous');
    old.appendChild(node('del', '', euro.format(d.oldPrice)));
    old.appendChild(node('span', '', 'Prejšnja cena (30 dni)'));
    priceInfo.appendChild(old);
  }
  if (d.promoPrice != null && (d.price == null || d.promoPrice < d.price)) priceInfo.appendChild(node('div','promo-price',`Cena s kodo: ${euro.format(d.promoPrice)}`));
  if (d.promoPercent && d.promoPrice == null && d.promoCode) priceInfo.appendChild(node('div','promo-price',`Popust s kodo: −${d.promoPercent} % (pogoji veljajo)`));
  if (d.promoCode) {
    const code = node('button','promo-code',`Koda: ${d.promoCode} ⧉`); code.type='button'; code.title='Kopiraj kodo za popust';
    code.addEventListener('click', async () => { try { await navigator.clipboard.writeText(d.promoCode); notice('Koda kopirana.'); } catch (_) { notice('Koda: '+d.promoCode); } });
    priceInfo.appendChild(code);
  }
  bottom.appendChild(priceInfo);
  if (row.fetchedAt) bottom.appendChild(node('div', 'updated', `Zadnji zajem: ${new Date(row.fetchedAt).toLocaleDateString('sl-SI')}`));
  const actions = node('div', 'product-actions');
  const details = node('button', 'card-details-btn', 'Podrobnosti ↗'); details.type = 'button'; details.addEventListener('click', () => openDetails(row.key)); actions.appendChild(details);
  const ref = P.cleanURL(row.url || '');
  if (ref) { const link = node('a', 'card-view-btn', 'Mimovrste ↗'); link.href = ref; link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.appendChild(link); }
  else { const b = node('button', 'card-view-btn', '↻ Poskusi znova'); b.type = 'button'; b.addEventListener('click', () => refreshRows([row.key])); actions.appendChild(b); }
  if (ref && row.id) { const retry = node('button', 'card-search-link', '↻ Poskusi znova'); retry.type = 'button'; retry.addEventListener('click', () => refreshRows([row.key])); content.appendChild(retry); }
  if (!ref && row.id) { const search = node('a', 'card-search-link', 'Poišči ID na Mimovrste ↗'); search.href = P.searchURL(row.id); search.target = '_blank'; search.rel = 'noopener noreferrer'; content.appendChild(search); }
  bottom.appendChild(actions); content.appendChild(bottom); card.appendChild(content); return card;
}
function openLayer(name) {
  const el = $(name + 'Layer'); el.hidden = false;
  document.body.classList.add('no-scroll');
}
function closeLayer(name) {
  $(name + 'Layer').hidden = true;
  if ([...document.querySelectorAll('.modal-layer')].every(x => x.hidden)) document.body.classList.remove('no-scroll');
}
function openImport() { $('importFeedback').textContent = ''; openLayer('import'); $('importText').focus(); }
async function submitImport() {
  if (busy) return;
  const { entries, ignored } = P.splitEntries($('importText').value);
  if (!entries.length) { $('importFeedback').textContent = 'Vnesi vsaj en veljaven ID ali povezavo do Mimovrste.'; return; }
  if (entries.length > BATCH_LIMIT) { $('importFeedback').textContent = 'Naenkrat lahko uvoziš največ 200 izdelkov.'; return; }
  const result = await addEntries(entries);
  closeLayer('import'); $('importText').value = '';
  notice(`Dodanih ${result.added} · že obstoječih ${result.existing}${result.limitSkipped ? ` · ${result.limitSkipped} nad omejitvijo 200` : ''}${ignored ? ` · prezrtih ${ignored}` : ''}.`, result.limitSkipped > 0);
  await refreshRows(result.keys);
}
function openDetails(key) {
  selectedKey = key; detailTab = 'spec';
  renderDetails(); openLayer('details');
}
function renderDetails() {
  const row = items.find(x => x.key === selectedKey); if (!row) return;
  const d = effective(row);
  $('detailsTitle').textContent = d.title || `Artikel ${row.id || ''}`;
  $('detailsBrand').textContent = d.brand || 'PODROBNOSTI IZDELKA';
  $('detailsId').textContent = `ID: ${row.id || '—'}${row.verified && !row.error ? (row.verificationSource === 'stran' ? ' · ✓ ujemanje na strani' : ' · ✓ ujemanje v javnem indeksu') : ''}${row.fetchedAt ? ' · Zajeto: ' + new Date(row.fetchedAt).toLocaleString('sl-SI') : ''}`;
  $('detailsPrice').replaceChildren();
  $('detailsPrice').appendChild(node('strong', '', d.price != null ? euro.format(d.price) : 'Cena ni na voljo'));
  if (pct(d)) { $('detailsPrice').appendChild(node('del', '', euro.format(d.oldPrice))); $('detailsPrice').appendChild(node('span', 'details-sale', `−${pct(d)} %`)); }
  if (d.promoPrice != null) $('detailsPrice').appendChild(node('span', 'details-sale', `Cena s kodo: ${euro.format(d.promoPrice)}`));
  if (d.promoPercent && d.promoCode && d.promoPrice == null) $('detailsPrice').appendChild(node('span', 'details-sale', `S kodo −${d.promoPercent} % (pogoji veljajo)`));
  if (d.promoCode) $('detailsPrice').appendChild(node('span', 'details-sale', `Koda: ${d.promoCode}`));
  const detailPictures = [...new Set([d.image, ...(d.images || [])].filter(src => /^https:\/\//i.test(src || '')))];
  $('detailsImage').hidden = !detailPictures.length; $('detailsPlaceholder').hidden = !!detailPictures.length;
  $('detailsImage').onerror = null;
  if (detailPictures.length) {
    let n = 0;
    $('detailsImage').referrerPolicy = 'no-referrer';
    $('detailsImage').onerror = () => {n++; if (n < detailPictures.length) $('detailsImage').src = detailPictures[n]; else { $('detailsImage').hidden = true; $('detailsPlaceholder').hidden = false; }};
    $('detailsImage').src = detailPictures[0];
  } else $('detailsImage').removeAttribute('src');
  const safe = P.cleanURL(row.url || ''); $('detailsLink').href = safe || '#'; $('detailsLink').hidden = !safe;
  document.querySelectorAll('.detail-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === detailTab));
  const body = $('detailsBody'); body.replaceChildren();
  if (detailTab === 'description') {
    body.appendChild(node('h3', 'detail-subheading', 'Opis izdelka'));
    body.appendChild(node('p', 'detail-description', d.description || 'Opis ni na voljo.'));
  } else if (detailTab === 'photos') {
    const images = [...new Set([d.image, ...(d.images || [])].filter(x => /^https:\/\//i.test(x || '')))];
    body.appendChild(node('h3', 'detail-subheading', `Fotografije artikla (${images.length})`));
    if (!images.length) body.appendChild(node('p', 'detail-description', 'Fotografij ni bilo mogoče pridobiti. Poskusi osvežiti artikel ali ga odpri na Mimovrste.'));
    else {
      const photos = node('div', 'photo-gallery');
      images.slice(0, 10).forEach((url, i) => {
        const link = node('a', 'photo-tile'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.title = 'Odpri originalno fotografijo ' + (i + 1);
        const img = node('img'); img.src = url; img.loading = 'lazy'; img.alt = `Fotografija ${i + 1}: ${d.title || 'artikel'}`;
        img.addEventListener('error', () => { link.classList.add('photo-error'); link.textContent = 'Slika ni dosegljiva'; }, { once: true });
        link.appendChild(img); photos.appendChild(link);
      });
      body.appendChild(photos);
    }
  } else if (detailTab === 'spec') {
    body.appendChild(node('h3', 'detail-subheading', 'Tehnični podatki'));
    const specs = Object.entries(d.specs || {});
    if (specs.length) {
      const table = node('div', 'spec-table');
      specs.forEach(([key, value]) => { const r = node('div', 'spec-row'); r.appendChild(node('span', '', key)); r.appendChild(node('strong', '', value)); table.appendChild(r); });
      body.appendChild(table);
    } else body.appendChild(node('p', 'detail-description', 'Tehnične specifikacije niso bile dostopne. Lahko jih vneseš ročno v zavihku »Ročni popravek«.'));
    if (row.error) body.appendChild(node('p', 'detail-warning', `Napaka pri osveževanju: ${row.error}`));
  } else renderEditForm(body, row, d);
}
function renderEditForm(body, row, d) {
  const note = node('p', 'form-note', 'Spremenjena polja imajo prednost pred samodejnimi podatki. Prazno polje uporablja izvirni podatek.'); body.appendChild(note);
  const form = node('form', 'edit-form'); form.id = 'editForm';
  const fields = [['title','Ime izdelka','text'],['brand','Znamka','text'],['image','URL fotografije','url'],['price','Trenutna cena (€)','text'],['oldPrice','Prejšnja cena (€)','text'],['promoPrice','Cena s kodo (€)','text'],['promoCode','Koda za popust','text'],['description','Opis','textarea'],['specs','Tehnične lastnosti (Lastnost: vrednost)','textarea']];
  for (const [key, label, type] of fields) {
    const wrap = node('label', 'edit-field'); wrap.appendChild(node('span', '', label));
    const field = node(type === 'textarea' ? 'textarea' : 'input'); field.name = key;
    if (type !== 'textarea') field.type = type;
    const existing = row.overrides?.[key];
    field.value = existing != null ? (key === 'specs' ? Object.entries(existing).map(([k,v]) => `${k}: ${v}`).join('\n') : String(existing)) : '';
    if (key === 'specs') field.rows = 5;
    if (key === 'description') field.rows = 3;
    if (key === 'price' || key === 'oldPrice' || key === 'promoPrice') field.placeholder = d[key] == null ? 'npr. 99,90' : String(d[key]).replace('.', ',');
    wrap.appendChild(field); form.appendChild(wrap);
  }
  const saveBtn = node('button', 'btn btn-primary', 'Shrani popravke'); saveBtn.type = 'submit'; form.appendChild(saveBtn);
  const refreshBtn = node('button', 'btn btn-secondary', '↻ Osveži iz Mimovrste'); refreshBtn.type = 'button'; refreshBtn.addEventListener('click', () => { closeLayer('details'); refreshRows([row.key]); }); form.appendChild(refreshBtn);
  form.addEventListener('submit', async e => {
    e.preventDefault(); const fd = new FormData(form); const overrides = {};
    for (const [key, raw] of fd.entries()) {
      const str = String(raw).trim(); if (!str) continue;
      if (['price','oldPrice','promoPrice'].includes(key)) {
        const value = asNum(str); if (value === null) { notice('Cena ni v pravilnem zapisu.', true); return; }
        overrides[key] = value;
      } else if (key === 'specs') {
        const specs = {};
        for (const line of str.split(/\r?\n/)) { const pos = line.indexOf(':'); if (pos < 2) continue; const k = line.slice(0,pos).trim().slice(0,70), v = line.slice(pos+1).trim().slice(0,230); if (k && v && Object.keys(specs).length < 42) specs[k] = v; }
        overrides.specs = specs;
      } else if (key === 'image') {
        try { const url = new URL(str); if (url.protocol !== 'https:') throw new Error(); overrides.image = url.href; } catch (_) { notice('Fotografija mora imeti povezavo HTTPS.', true); return; }
      } else overrides[key] = str.slice(0, key === 'description' ? 2500 : 300);
    }
    row.overrides = overrides; await save(); render(); renderDetails(); notice('Ročni popravki so shranjeni.');
  });
  body.appendChild(form);
}
function exportCSV() {
  if (!items.length) { notice('Katalog je prazen.'); return; }
  const escape = v => {
    let s = String(v ?? '').replace(/\r?\n/g, ' ');
    // Prevent formula execution when opening the CSV in a spreadsheet.
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const lines = [['ID','Naziv','Znamka','Cena EUR','Prejšnja cena EUR','Popust %','Cena s kodo EUR','Koda za popust','Popust s kodo %','Opis','Tehnične lastnosti','Povezava','Način preverjanja','Napaka','Opozorilo','Zadnji zajem'].map(escape).join(';')];
  items.forEach(row => {
    const d = effective(row);
    const spec = Object.entries(d.specs || {}).map(([k,v]) => `${k}: ${v}`).join(' | ');
    lines.push([row.id, d.title, d.brand, d.price ?? '', d.oldPrice ?? '', pct(d) || '', d.promoPrice ?? '', d.promoCode ?? '', d.promoPercent ?? '', d.description, spec, row.url, row.verificationSource || '', row.error || '', row.warning || '', row.fetchedAt ? new Date(row.fetchedAt).toLocaleString('sl-SI') : ''].map(escape).join(';'));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = node('a'); a.href = url; a.download = 'mimo-pregled-' + new Date().toISOString().slice(0,10) + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500); notice('Izvoz CSV je pripravljen.');
}
function register() {
  ['importBtn','sideImport','emptyImportBtn'].forEach(id => $(id).addEventListener('click', openImport));
  ['refreshBtn','listRefreshBtn'].forEach(id => $(id).addEventListener('click', () => refreshRows(items.map(x => x.key))));
  $('stopBtn').addEventListener('click', () => { stopRequested = true; $('progressText').textContent = 'Ustavljam po že začetih izdelkih …'; });
  $('workerCount').addEventListener('change', () => chrome.storage.local.set({workerCount: Number($('workerCount').value)}));
  $('cacheRecent').addEventListener('change', () => chrome.storage.local.set({cacheRecent: $('cacheRecent').checked}));
  ['sideExport'].forEach(id => $(id).addEventListener('click', exportCSV));
  ['printBtn','sidePrint'].forEach(id => $(id).addEventListener('click', () => {
    const scope = view === 'missing' ? 'all' : 'discounts';
    const url = chrome.runtime.getURL('print.html') + '?scope=' + encodeURIComponent(scope);
    chrome.tabs.create({url}).catch(() => notice('Predogleda za tisk ni bilo mogoče odpreti.', true));
  }));
  $('searchInput').addEventListener('input', render);
  $('sortSelect').addEventListener('change', render);
  $('submitImport').addEventListener('click', submitImport);
  document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => { view = btn.dataset.view; render(); }));
  document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => closeLayer(el.dataset.close)));
  document.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click', () => { detailTab = el.dataset.tab; renderDetails(); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeLayer('import'); closeLayer('details'); } });
}
async function init() {
  register();
  try {
    const db = await chrome.storage.local.get(['products','pendingImports','pendingCaptured','pendingImportText','workerCount','cacheRecent']);
    $('workerCount').value = String([2,3,4].includes(Number(db.workerCount)) ? Number(db.workerCount) : 3);
    $('cacheRecent').checked = db.cacheRecent !== false;
    items = Array.isArray(db.products) ? db.products.filter(x => x && typeof x.key === 'string').slice(0,BATCH_LIMIT) : [];
    render();
    const captured = (db.pendingCaptured || []).filter(x => x && P.cleanURL(x.url) && x.data?.title).slice(0,200);
    if (captured.length) {
      await chrome.storage.local.remove('pendingCaptured');
      const result = await addEntries(captured.map(x => ({url:P.cleanURL(x.url), id:P.idFromURL(x.url)})));
      for (const record of captured) {
        const row = items.find(x => x.url === P.cleanURL(record.url));
        if (row) { row.data = record.data; row.fetchedAt = Date.now(); row.error = ''; }
      }
      await save(); render(); notice(`Dodano z odprte strani: ${result.added} izdelkov${result.limitSkipped ? ` · ${result.limitSkipped} nad omejitvijo 200` : ''}.`, result.limitSkipped > 0);
    }
    const pending = (db.pendingImports || []).map(url => P.cleanURL(url)).filter(Boolean);
    const fromPopup = P.splitEntries(db.pendingImportText || '').entries;
    if (pending.length || fromPopup.length) {
      await chrome.storage.local.remove('pendingImports');
      await chrome.storage.local.remove('pendingImportText');
      const outcome = await addEntries([...fromPopup, ...pending.map(url => ({ url, id: P.idFromURL(url) }))]);
      if (outcome.keys.length) await refreshRows(outcome.keys);
    }
  } catch (e) { notice('Shranjevanje ni na voljo: ' + e.message, true); }
}
init();
