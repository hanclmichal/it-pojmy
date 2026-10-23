// "Nastavení": repository connection, synchronisation, appearance, storage.
import { store, setConn, resetLocal, pendingFiles, removeFile } from '../store.js';
import { sync, testConnection, status } from '../sync.js';
import { h, put, toast, openSheet, closeSheet, confirmSheet, fmtTime } from '../ui.js';
import { plural, parsePage } from '../format.js';
import { mount, MERMAID_URL, loadMermaid } from '../render.js';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

function connectForm(nav, onDone) {
  const c = store.conn || {};
  const owner = h('input', { class: 'field', type: 'text', value: c.owner || 'hanclmichal', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  const repo = h('input', { class: 'field', type: 'text', value: c.repo || 'it-pojmy-data', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  const token = h('input', { class: 'field', type: 'password', placeholder: c.token ? 'Uložený klíč zůstane, pokud pole necháte prázdné' : 'github_pat_…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const branch = h('input', { class: 'field', type: 'text', value: c.branch || 'main', autocapitalize: 'off' });
  const api = h('input', { class: 'field', type: 'url', value: c.api || '', placeholder: 'https://api.github.com', autocapitalize: 'off' });
  const msg = h('p', { class: 'muted', role: 'status' });
  const btn = h('button', { class: 'btn btn--primary', type: 'submit' }, store.conn ? 'Uložit a synchronizovat' : 'Připojit a stáhnout');
  const form = h('form', { class: 'form', onsubmit: async ev => {
    ev.preventDefault();
    const conn = {
      owner: owner.value.trim(), repo: repo.value.trim(), branch: branch.value.trim() || 'main',
      token: token.value.trim() || c.token || '', api: api.value.trim() || undefined
    };
    if (!conn.owner || !conn.repo || !conn.token) { msg.textContent = 'Vyplňte vlastníka, úložiště a přístupový klíč.'; return; }
    btn.disabled = true;
    msg.textContent = 'Ověřuji přístup…';
    try {
      await testConnection(conn);
      const changedRepo = c.owner && (c.owner !== conn.owner || c.repo !== conn.repo || (c.api || '') !== (conn.api || ''));
      if (changedRepo) await resetLocal();
      await setConn(conn);
      msg.textContent = 'Stahuji pojmy…';
      const r = await sync();
      msg.textContent = '';
      toast(`Připojeno. Staženo ${r.pulled} ${plural(r.pulled, 'soubor', 'soubory', 'souborů')}.`);
      onDone();
    } catch (e) {
      msg.textContent = e.message || String(e);
    } finally { btn.disabled = false; }
  } },
    h('label', { class: 'form__row' }, h('span', { class: 'form__label', text: 'Vlastník' }), owner),
    h('label', { class: 'form__row' }, h('span', { class: 'form__label', text: 'Úložiště' }), repo),
    h('label', { class: 'form__row' }, h('span', { class: 'form__label', text: 'Přístupový klíč' }), token,
      h('span', { class: 'muted small' }, 'Fine-grained token jen pro toto úložiště s oprávněním Contents: Read and write. ', h('a', { href: TOKEN_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Vytvořit na GitHubu' }))),
    h('details', { class: 'adv' }, h('summary', { text: 'Pokročilé' }),
      h('label', { class: 'form__row' }, h('span', { class: 'form__label', text: 'Větev' }), branch),
      h('label', { class: 'form__row' }, h('span', { class: 'form__label', text: 'Adresa API' }), api)),
    msg,
    h('div', { class: 'row-actions' }, btn));
  return form;
}

export function render(root, params, nav) {
  nav.setTitle('Nastavení');
  async function draw() {
    const pend = pendingFiles();
    const c = store.conn;
    const box = h('div', { class: 'settings narrow' });

    const standalone = (window.navigator.standalone === true) || matchMedia('(display-mode: standalone)').matches;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios && !standalone) {
      box.append(h('div', { class: 'note note--soft' },
        h('strong', { text: 'Nejdřív si aplikaci přidejte na plochu' }),
        h('p', { text: 'V Safari klepněte na Sdílet a zvolte Přidat na plochu. Aplikace na ploše má vlastní úložiště, takže připojení a pojmy nastavte až v ní.' })));
    }
    if (!c) {
      box.append(h('section', { class: 'panel' },
        h('h2', { text: 'Připojení k úložišti' }),
        h('p', { text: 'Aplikace si stáhne pojmy ze soukromého úložiště na GitHubu a uloží je do telefonu. Pak funguje i bez internetu a změny odešle, jakmile bude signál.' }),
        connectForm(nav, () => nav.go('#/dnes'))));
      put(root, box);
      return;
    }

    const err = status.error;
    box.append(h('section', { class: 'panel' },
      h('h2', { text: 'Úložiště' }),
      h('dl', { class: 'kv' },
        h('dt', { text: 'Připojeno' }), h('dd', null, h('a', { href: `https://github.com/${c.owner}/${c.repo}`, target: '_blank', rel: 'noopener noreferrer', text: `${c.owner}/${c.repo}` })),
        h('dt', { text: 'Poslední synchronizace' }), h('dd', { text: store.lastSync ? fmtTime.format(new Date(store.lastSync)) : 'zatím neproběhla' }),
        h('dt', { text: 'Čeká na odeslání' }), h('dd', { text: pend.length ? pend.map(f => { const p = parsePage(f.text || f.base); return p ? p.meta.pojem : f.path; }).join(', ') : 'nic' }),
        err ? h('dt', { text: 'Poslední chyba' }) : null, err ? h('dd', { class: 'warn', text: err.message }) : null),
      h('div', { class: 'row-actions row-actions--wrap' },
        h('button', { class: 'btn btn--primary', type: 'button', onclick: () => nav.runSync(true) }, 'Synchronizovat teď'),
        h('button', { class: 'btn', type: 'button', onclick: () => openSheet('Připojení', connectForm(nav, () => draw())) }, 'Změnit připojení'))));

    const conflicts = [...store.files.values()].filter(f => f.path.startsWith('konflikty/') && !f.deleted).sort((a, b) => b.path.localeCompare(a.path));
    if (conflicts.length) {
      box.append(h('section', { class: 'panel' },
        h('h2', { text: 'Konflikty' }),
        h('p', { class: 'muted', text: 'Verze z úložiště, které se nedaly sloučit se změnou z telefonu. Stránka si ponechala text z telefonu. Porovnejte, případně přeneste, co chybí, a kopii smažte.' }),
        h('ul', { class: 'choices' }, conflicts.map(f => h('li', null, h('button', { type: 'button', onclick: () => {
          const d = h('div', { class: 'prose' });
          mount(d, f.text);
          openSheet(f.path.replace('konflikty/', ''), d, { full: true, action: h('button', { class: 'btn btn--sm btn--danger-quiet', type: 'button', onclick: () => confirmSheet('Smazat kopii?', 'Kopie zmizí z telefonu i z úložiště.', 'Smazat', async () => { await removeFile(f.path); closeSheet(); toast('Kopie smazána.'); }, true) }, 'Smazat') });
        } }, h('span', { class: 'pick__t' }, h('b', { text: f.path.replace('konflikty/', '').replace(/\.md$/, '') }), h('small', { text: 'Zobrazit' }))))))));
    }

    let theme = 'system';
    try { theme = localStorage.getItem('theme') || 'system'; } catch (e) { /* storage blocked */ }
    box.append(h('section', { class: 'panel' },
      h('h2', { text: 'Vzhled' }),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Vzhled' }, [['system', 'Podle systému'], ['light', 'Světlý'], ['dark', 'Tmavý']].map(([k, l]) =>
        h('button', { type: 'button', 'aria-pressed': String(theme === k), onclick: () => { try { localStorage.setItem('theme', k); } catch (e) { /* ignore */ } nav.applyTheme(k); draw(); } }, l)))));

    const offline = h('dl', { class: 'kv' });
    box.append(h('section', { class: 'panel' }, h('h2', { text: 'Offline' }), offline,
      h('div', { class: 'row-actions row-actions--wrap' },
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          try { await loadMermaid(); toast('Diagramy jsou připravené i pro offline.'); } catch (e) { toast('Diagramy teď nejde stáhnout. Zkuste to s internetem.'); }
          draw();
        } }, 'Připravit diagramy'))));

    box.append(h('section', { class: 'panel' },
      h('h2', { text: 'Knowledge base' }),
      h('p', { text: `${store.pages.size} ${plural(store.pages.size, 'pojem', 'pojmy', 'pojmů')} v telefonu.` }),
      h('div', { class: 'row-actions row-actions--wrap' },
        store.rules ? h('button', { class: 'btn', type: 'button', onclick: () => { const d = h('div', { class: 'prose' }); mount(d, store.rules.replace(/^# .*\n/, '')); openSheet('Pravidla knowledge base', d, { full: true }); } }, 'Pravidla knowledge base') : null,
        h('button', { class: 'btn btn--danger-quiet', type: 'button', onclick: () => confirmSheet('Načíst vše znovu?', pend.length ? `Smaže kopii v telefonu i ${pend.length} neodeslaných změn a stáhne vše znovu z GitHubu.` : 'Smaže kopii v telefonu a stáhne vše znovu z GitHubu.', 'Načíst znovu', async () => {
          await resetLocal();
          try { await sync(); toast('Staženo znovu.'); } catch (e) { toast(e.message); }
        }, true) }, 'Načíst vše znovu z GitHubu'))));

    box.append(h('p', { class: 'muted small center', text: 'IT Pojmy 1.0 · data zůstávají v telefonu a ve vašem úložišti na GitHubu.' }));
    put(root, box);

    // async details
    let persisted = false, est = null, diagrams = false;
    try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch (e) { /* ignore */ }
    try { est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (e) { /* ignore */ }
    try { diagrams = !!(window.caches && await caches.match(MERMAID_URL)); } catch (e) { /* ignore */ }
    put(offline,
      h('dt', { text: 'Trvalé úložiště' }), h('dd', { text: persisted ? 'ano, systém data nesmaže' : 'nepotvrzeno (aplikace přidaná na plochu má vlastní úložiště)' }),
      est ? h('dt', { text: 'Obsazeno' }) : null, est ? h('dd', { text: `${(est.usage / 1048576).toFixed(1)} MB` }) : null,
      h('dt', { text: 'Diagramy' }), h('dd', { text: diagrams || window.mermaid ? 'připravené pro offline' : 'stáhnou se při prvním zobrazení s internetem' }));
  }
  draw();
  return { refresh: draw };
}
