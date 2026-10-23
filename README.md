# IT Pojmy

Offline aplikace pro osobní IT knowledge base. Běží v Safari jako aplikace na ploše (PWA),
data drží v telefonu a synchronizuje je se soukromým úložištěm `hanclmichal/it-pojmy-data`.

## Co umí

- **Dnes:** denní řada opakování (1–10 témat), hodnocení Nevím / Těžké / Dobré / Snadné,
  intervaly 1 / 7 / 30 / 90 dní, otázky z „Otestuj se“ jako kartičky, série dní.
- **Pojmy:** pohledy Podle kategorie (rozbalovací seznamy), Dnes opakovat, Podle úrovně a Všechny pojmy
  a hledání v názvech i v celém textu stránek.
- **Stránka pojmu:** vlastnosti, obousměrné vazby „Souvisí s“, lišta sekcí, tabulky, zvýrazněný kód,
  diagramy Mermaid, rozbalovací bloky. Úpravy po sekcích, nová sekce, přejmenování, smazání.
- **Nový pojem** ze šablony s výchozími hodnotami podle `schema.json` v datovém úložišti.
- **Přehled:** úrovně znalosti, kategorie, termíny na 14 dní, historie opakování.
- **Offline:** service worker drží celou aplikaci, IndexedDB celou knowledge base. Změny se odešlou
  jedním commitem, jakmile je signál. Souběžné úpravy se slučují po vlastnostech a po sekcích;
  co sloučit nejde, zůstane jako kopie ve složce `konflikty/` a v Nastavení.

## Jak to funguje

```
iPhone (aplikace na ploše)                      GitHub
┌──────────────────────────────┐                ┌──────────────────────────────┐
│ Service worker: kód aplikace │                │ hanclmichal/it-pojmy (veřejné)│ ← GitHub Pages
│ IndexedDB: pojmy + změny     │ ── Git Data API ──▶ hanclmichal/it-pojmy-data │ ← soukromá data
└──────────────────────────────┘                └──────────────────────────────┘
```

Synchronizace používá Git Data API (`git/trees`, `git/commits`, `git/refs`): stáhne jen soubory
se změněným blobem a odešle všechny změny z telefonu jako jeden commit (jen fast-forward).

## Struktura

```
index.html, styles.css, sw.js, manifest.webmanifest
app/        moduly aplikace (ES modules, bez build kroku)
  views/    obrazovky
vendor/     marked 4.3.0, DOMPurify 3.4.17, highlight.js 11.12.0 (+ licence)
icons/      ikony aplikace
```

Mermaid 11.12.0 se načítá z cdn.jsdelivr.net při prvním zobrazení diagramu a service worker
ho uloží pro offline použití.

## Nasazení

GitHub Pages z větve `main`, složka `/` (root). Při každé změně kódu zvýšit `VERSION` v `sw.js`,
aby si telefony stáhly novou verzi (aplikace pak nabídne „Načíst“).
