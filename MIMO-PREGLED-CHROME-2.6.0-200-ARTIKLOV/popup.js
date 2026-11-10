'use strict';
const $ = id => document.getElementById(id);
$('openDash').addEventListener('click', async () => { await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }); window.close(); });
$('openPrint').addEventListener('click', async () => { await chrome.tabs.create({url:chrome.runtime.getURL('print.html')}); window.close(); });
$('addCurrent').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = MimoParser.cleanURL(tab?.url || '');
  if (!url) { $('message').textContent = 'Najprej odpri stran izdelka na mimovrste.com.'; return; }
  let captured = null;
  try {
    const result = await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['parser.js', 'capture.js']});
    if (result?.[0]?.result?.item) captured = result[0].result.item;
  } catch (_) { /* Fallback to fetching the public product page in the dashboard. */ }
  if (captured) {
    const previous = await chrome.storage.local.get('pendingCaptured');
    const pending = (previous.pendingCaptured || []).filter(x => x.url !== url);
    await chrome.storage.local.set({ pendingCaptured: [...pending, {url, data: captured}].slice(-200) });
  } else {
    const stored = await chrome.storage.local.get('pendingImports');
    await chrome.storage.local.set({ pendingImports: [...new Set([...(stored.pendingImports || []), url])].slice(-200) });
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  window.close();
});

$('quickAdd').addEventListener('click', async () => {
  const parsed = MimoParser.splitEntries($('quickIDs').value);
  if (!parsed.entries.length) { $('message').textContent = 'Vnesi vsaj en veljaven ID ali povezavo.'; return; }
  if (parsed.entries.length > 200) { $('message').textContent = 'Naenkrat je dovoljenih največ 200 vnosov.'; return; }
  const old = await chrome.storage.local.get('pendingImportText');
  const combined = [old.pendingImportText || '', $('quickIDs').value].filter(Boolean).join('\n');
  const unique = MimoParser.splitEntries(combined).entries;
  if (unique.length > 200) { $('message').textContent = 'V vrsti je že 200 vnosov. Najprej jih obdelaj.'; return; }
  // Preserve the exact ID+URL pairs; dashboard validates each one before adding.
  await chrome.storage.local.set({pendingImportText: unique.map(x => x.id && x.url ? `${x.id} | ${x.url}` : (x.url || x.id)).join('\n')});
  await chrome.tabs.create({url: chrome.runtime.getURL('dashboard.html')});
  window.close();
});
