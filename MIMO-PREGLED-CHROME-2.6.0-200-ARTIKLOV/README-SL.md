# Mimo Pregled 2.6 – Google Chrome (do 200 artiklov)

Ta paket je prilagojena **Chrome različica Firefox izdaje 2.6.0**, z istim videzom in funkcijami, vključno z A4 tiskanjem.

## Namestitev (Chrome na Windows)

1. Prenesi in **razširi ZIP** v stalno mapo, npr. `Dokumenti\Mimo-Pregled-Chrome`.
2. V Chromu odpri `chrome://extensions`.
3. Zgoraj desno vklopi **Developer mode / Način za razvijalce**.
4. Klikni **Load unpacked / Naloži razširjeno**.
5. Izberi **mapo**, v kateri je `manifest.json` (ne izbiraj ZIP datoteke ali datoteke `manifest.json`).
6. Prek ikone sestavljanke pripni **Mimo Pregled** v orodno vrstico in odpri katalog.

Chrome si razvojno razširitev običajno zapomni tudi po ponovnem zagonu. Mape po namestitvi **ne premikaj in ne briši**. Če Chrome prikaže varnostno opozorilo o razvojnih razširitvah, ga lahko pregledaš v `chrome://extensions`.

## Funkcije

- Uvoz **do 200 izdelkov skupaj**, po ID-jih ali povezavah (posamezne ali množično).
- Nastavitev 2 / 3 / 4 vzporednih preverjanj; 15-minutni predpomnilnik.
- Iskanje najprej prek Mimovrste `/iskanje?s=ID` in `/iskanje?q=ID`, nato rezervni javni iskalniki.
- Prikaz fotografij, nazivov, specifikacij, trenutnih / prejšnjih cen, cen s kodo in promocijskih kod, če so dejansko objavljene.
- Izvoz CSV, podrobnosti, ročni popravki, osveževanje in seznam za **tisk A4** (pregleden ali varčen).
- Dodajanje trenutno odprte strani Mimovrste prek gumba v majhnem oknu razširitve.

## Pomembne omejitve

- Gre za neodvisno razširitev, **ne za uradni API** Mimovrste. Stran lahko podatke omeji, spremeni strukturo ali prikaže cene šele po nalaganju JavaScripta. Zato **ne moremo jamčiti**, da bo našla vse ID-je, slike, cene ali kode. Cene pred tiskanjem nalepk preveri na sami trgovini.
- Razširitev je preverjena glede sintakse, shranjevanja, uporabniškega vmesnika in izrisa v testnem Chromiu, vendar **živ prenos vseh podatkov Mimovrste ni potrjen**.
- Chrome in Firefox imata ločeni shrambi. Obstoječi Firefox artikli se **ne prenesejo samodejno** v Chrome. Če želiš enak seznam, vanj ponovno prilepi ID-je ali povezave; izvoz CSV je namenjen preglednici in varnostni kopiji.
- Razširitev dostopa do Mimovrste in do javnih iskalnikov ter lahko med iskanjem odpira neaktivne zavihke, ki jih nato zapre. Podatki se shranjujejo lokalno v Chrome in niso poslani na ločen strežnik razširitve.

## Tiskanje

V katalogu izberi **Natisni seznam** ali odpri tisk iz popup okenca. Izberi obseg (vsi / znižani / s prejšnjo ceno / s kodo), postavitev in klikni **Natisni / shrani PDF**.

Za sveže cene pred menjavo nalepk odznači **Pomni 15 min**, izvedi osvežitev ter preveri veljavnost promocijskih kod.
