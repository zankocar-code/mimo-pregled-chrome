/* Mimo Pregled 2.6 – print page: local products only; no remote script or analytics. */
'use strict';
const $$ = id => document.getElementById(id);
const fmtEUR = new Intl.NumberFormat('sl-SI',{style:'currency',currency:'EUR'});
const fmtDate = time => new Intl.DateTimeFormat('sl-SI',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(time));
const el = (tag, cls, txt) => {
  const result=document.createElement(tag);
  if (cls) result.className=cls;
  if (txt != null) result.textContent=String(txt);
  return result;
};
let rows=[];
let imageLoads=[];
let pendingPrint=false;
let loadSerial=0;
function addPrice(container, caption, amount, cssClass, {strike=false}={}) {
  const card=el('div','price-box '+cssClass+(amount==null?' not-available':''));
  card.appendChild(el('span','',caption));
  const display=amount==null?'—':fmtEUR.format(amount);
  const label=el('strong','',display);
  if (strike) label.classList.add('struck');
  card.appendChild(label);
  container.appendChild(card);
}
function prepareImage(parent, candidates, title) {
  if (!candidates.length) { parent.appendChild(el('span','photo-fallback','Brez fotografije')); return Promise.resolve(false); }
  const img=el('img'); img.alt=title; img.referrerPolicy='no-referrer'; img.loading='eager'; img.decoding='sync';
  parent.appendChild(img);
  return new Promise(resolve=>{
    let settled=false, index=0;
    const timer=setTimeout(()=>finish(false),11500);
    function finish(ok){
      if (settled) return; settled=true;clearTimeout(timer);
      if (!ok) {img.remove();parent.appendChild(el('span','photo-fallback','Fotografija ni na voljo'));}
      resolve(ok);
    }
    img.onload=()=>finish(true);
    img.onerror=()=>{
      index++;
      if (index<candidates.length) img.src=candidates[index];
      else finish(false);
    };
    img.src=candidates[index];
  });
}
function itemNode(x) {
  const article=el('article','print-item');
  article.appendChild(el('span','print-check'));
  const media=el('div','print-photo'); article.appendChild(media);
  imageLoads.push(prepareImage(media,x.imageURLs,x.title));
  const main=el('div','item-main');article.appendChild(main);
  const line=el('div','item-line');
  const info=el('div');
  if (x.brand) info.appendChild(el('span','item-brand',x.brand));
  info.appendChild(el('h2','item-name',x.title));
  info.appendChild(el('p','item-id',`ID: ${x.id}`));
  line.appendChild(info);
  if (x.discount) line.appendChild(el('span','discount-pill',`−${x.discount} %`));
  main.appendChild(line);
  const prices=el('div','price-row');
  // Show old price only if it was supplied by the source; never invent regular price.
  if (x.oldPrice != null && x.price != null && x.oldPrice>x.price) addPrice(prices,'Prejšnja cena (30 dni)',x.oldPrice,'old',{strike:true});
  addPrice(prices,x.discount?'Akcijska cena':'Cena na Mimovrste',x.price,'current');
  if (x.promoPrice != null && (x.price == null || x.promoPrice < x.price)) addPrice(prices,'Cena s kodo',x.promoPrice,'promo');
  main.appendChild(prices);
  if (x.promoCode) main.appendChild(el('div','promo-code',`KODA: ${x.promoCode}`));
  if (x.promoPercent && x.promoPrice == null && x.promoCode) main.appendChild(el('div','promo-only',`Popust s kodo: −${x.promoPercent} % · cena ni potrjena`));
  if (x.warning) main.appendChild(el('div','warning',`Preveri podatke: ${x.warning.slice(0,160)}`));
  else if (!x.verified) main.appendChild(el('div','warning','ID izdelka ni potrjen – preveri pred lepljenjem.'));
  if (x.updated) main.appendChild(el('div','updated',`Zadnje preverjanje: ${fmtDate(x.updated)}`));
  return article;
}
function setStatus(text){ $$('printStatus').textContent=text; }
function render() {
  const scope=$$('scopeSelect').value;
  const layout=$$('layoutSelect').value;
  const output=MimoPrintData.prepare(rows,scope,layout);
  const list=$$('printItems');list.replaceChildren();imageLoads=[];
  const serial=++loadSerial;
  $$('printHeading').textContent=scope==='all'?'Seznam izdelkov':(scope==='code'?'Seznam cen s kodo':'Pregled akcijskih cen');
  list.className='print-items'+(layout==='compact'?' compact':'');
  $$('printCount').textContent=String(output.records.length);
  $$('emptyNotice').hidden=output.records.length>0;
  const fragment=document.createDocumentFragment();
  output.records.forEach(x=>fragment.appendChild(itemNode(x)));
  list.appendChild(fragment);
  $$('printAction').disabled=output.records.length===0;
  setStatus(`${output.records.length} izdelkov · Pripravljam fotografije …`);
  Promise.allSettled([...imageLoads]).then(results => {
    if (serial !== loadSerial || pendingPrint) return;
    const ready=results.filter(r=>r.status==='fulfilled' && r.value===true).length;
    setStatus(`Pripravljenih ${output.records.length} artiklov · ${ready} fotografij naloženih. Če fotografija ni dosegljiva, se izpiše nadomestni napis.`);
  });
  return output.records.length;
}
async function printNow(){
  if (pendingPrint) return;
  if (!$$('printItems').children.length) return;
  pendingPrint=true;
  $$('printAction').disabled=true;
  setStatus('Pripravljam slike za tisk …');
  const currentLoads=[...imageLoads];
  await Promise.race([Promise.allSettled(currentLoads),new Promise(res=>setTimeout(res,12000))]);
  await new Promise(requestAnimationFrame);
  $$('printAction').disabled=false;
  pendingPrint=false;
  setStatus('Seznam je pripravljen. V Chromovem oknu za tisk lahko izbereš tudi »Shrani kot PDF«; preveri predogled slik.');
  window.print();
}
async function initPrint(){
  $$('printDate').textContent=fmtDate(Date.now());
  const params=new URLSearchParams(location.search);
  const requested=params.get('scope');
  const stored=await chrome.storage.local.get(['products','printPrefs']);
  const prefs=stored.printPrefs || {};
  rows=Array.isArray(stored.products)?stored.products:[];
  $$('scopeSelect').value=['all','discounts','sale','code'].includes(requested)?requested:(['all','discounts','sale','code'].includes(prefs.scope)?prefs.scope:'discounts');
  $$('layoutSelect').value=prefs.layout==='compact'?'compact':'list';
  const persist=async()=>{
    render();
    await chrome.storage.local.set({printPrefs:{scope:$$('scopeSelect').value,layout:$$('layoutSelect').value}});
  };
  $$('scopeSelect').addEventListener('change',persist);
  $$('layoutSelect').addEventListener('change',persist);
  $$('printAction').addEventListener('click',printNow);
  $$('backAction').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')}));
  render();
}
initPrint().catch(err=>{
  console.error('Print preview:',err);
  setStatus('Ni mogoče prebrati shranjenih izdelkov: '+String(err.message||err));
  $$('printAction').disabled=true;
});
