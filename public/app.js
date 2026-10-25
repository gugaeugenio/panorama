// Panorama — interface. Sem framework: rotas por hash, HTML montado com escape.

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const storyDialog = $('#story');
const storyBody = $('#story-body');

// Mesmas editorias de src/sources.js.
const SECTIONS = [
  { id: 'politica', name: 'Política' },
  { id: 'economia', name: 'Economia' },
  { id: 'mundo', name: 'Mundo' },
  { id: 'esporte', name: 'Esporte' },
  { id: 'brasil', name: 'Brasil' },
  { id: 'ciencia', name: 'Ciência e tecnologia' },
];

const state = {
  meta: { sections: SECTIONS },
  searchIndex: null,
  version: null,
  renderedVersion: null,
  updatedAt: null,
};

// ---------- utilidades ----------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

// Valores interpolados são escapados, exceto os já marcados como HTML seguro ({ __html }).
const render = (v) => (v == null || v === false ? '' : v.__html ?? esc(v));
const raw = (s) => ({ __html: s });
function html(strings, ...values) {
  return raw(strings.reduce((out, str, i) => out + render(values[i - 1]) + str));
}
const join = (list) => raw(list.map(render).join(''));

// ---------- edição privada (criptografada) ----------
// Quando existe data/cripto.json, todos os arquivos da edição vêm cifrados (AES-256-GCM, chave
// derivada da frase-senha com PBKDF2). A chave fica guardada só neste aparelho.

const KEY_STORAGE = 'panorama:chave';
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

async function importAesKey(raw) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
}

async function decrypt(buf, key) {
  const bytes = new Uint8Array(buf);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
}

async function gunzipJson(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

async function keyIsValid(key) {
  try {
    return new TextDecoder().decode(await decrypt(b64(state.cripto.check), key)) === 'panorama';
  } catch {
    return false;
  }
}

/** Deriva a chave da frase-senha; devolve null se a senha estiver errada. */
async function unlock(password) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const raw = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(state.cripto.salt), iterations: state.cripto.iterations }, material, 256);
  const key = await importAesKey(raw);
  if (!(await keyIsValid(key))) return null;
  try {
    localStorage.setItem(KEY_STORAGE, toB64(raw));
  } catch {
    /* navegação privada: a senha vale só enquanto o app estiver aberto */
  }
  return key;
}

async function storedKey() {
  try {
    const saved = localStorage.getItem(KEY_STORAGE);
    if (!saved) return null;
    const key = await importAesKey(b64(saved));
    return (await keyIsValid(key)) ? key : null;
  } catch {
    return null;
  }
}

function forgetKey() {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* ignora */
  }
}

/** Lê um arquivo da edição (data/...). O caminho é relativo para funcionar em qualquer endereço. */
async function data(path) {
  let res;
  try {
    // O endereço muda a cada edição (?v=), então o cache do GitHub nunca devolve uma edição velha.
    const v = path === 'versao.json' ? Date.now() : state.version || Date.now();
    res = await fetch(`data/${path}${state.key ? '.bin' : ''}?v=${encodeURIComponent(v)}`, { cache: 'no-cache' });
  } catch {
    throw new Error('Sem conexão e sem edição guardada neste aparelho');
  }
  if (res.status === 404) throw Object.assign(new Error('Não encontrado'), { status: 404 });
  if (!res.ok) throw new Error(`Erro ${res.status} ao carregar a edição`);
  if (!state.key) return res.json();
  try {
    return await gunzipJson(await decrypt(await res.arrayBuffer(), state.key));
  } catch {
    // A senha foi trocada no GitHub: pede a nova.
    forgetKey();
    location.reload();
    throw new Error('A senha deste aparelho não abre mais a edição');
  }
}

const fold = (s = '') => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const sectionName = (id) => state.meta?.sections.find((s) => s.id === id)?.name || id;

const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });
const longDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

function relTime(iso) {
  const diff = (Date.now() - Date.parse(iso)) / 60e3;
  if (diff < 1) return 'agora';
  if (diff < 60) return `há ${Math.round(diff)} min`;
  if (diff < 24 * 60) return `há ${Math.round(diff / 60)} h`;
  return `${dayFmt.format(new Date(iso))}, ${timeFmt.format(new Date(iso))}`;
}

function clockOrDay(iso) {
  const d = new Date(iso);
  return new Date().toDateString() === d.toDateString() ? timeFmt.format(d) : dayFmt.format(d);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- peças ----------

const storyHref = (id) => `#story=${id}`;
const checkIcon = '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M3 8.5 6.5 12 13 4.5"/></svg>';

function kicker(story, { link = true } = {}) {
  const sec = link
    ? html`<a class="kicker-section" href="#/s/${story.section}">${sectionName(story.section)}</a>`
    : html`<span class="kicker-section">${sectionName(story.section)}</span>`;
  return html`<p class="kicker">${sec}${story.assunto ? html`<span class="kicker-topic">${story.assunto}</span>` : ''}</p>`;
}

/** Linha de apuração: quantos veículos confirmaram e quando foi atualizado. */
function proof(story) {
  return html`<p class="proof">
    <span class="check" aria-hidden="true">${raw(checkIcon)}</span>
    <span>Confirmado por ${story.confirmations} veículos</span>
    <span class="proof-time">${relTime(story.updated)}</span>
  </p>`;
}

function headline(story, tag = 'h3') {
  return html`<${raw(tag)} class="headline"><a href="${storyHref(story.id)}" data-story="${story.id}">${story.title}</a></${raw(tag)}>`;
}

function img(src, cls, eager = false) {
  return src ? html`<img class="${cls}" src="${src}" alt="" loading="${eager ? 'eager' : 'lazy'}" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
}

function mancheteBlock(s) {
  return html`<article class="manchete ${s.image ? 'has-image' : ''}" data-section="${s.section}">
    <div class="manchete-text">
      ${kicker(s)}
      <h1><a href="${storyHref(s.id)}" data-story="${s.id}">${s.title}</a></h1>
      ${s.dek ? html`<p class="dek">${s.dek}</p>` : ''}
      ${proof(s)}
    </div>
    ${img(s.image, 'manchete-img', true)}
  </article>`;
}

function assuntoBlock(g) {
  const [main, ...rest] = g.stories;
  return html`<section class="assunto" data-section="${main.section}" aria-labelledby="as-${main.id}">
    <h3 class="assunto-name" id="as-${main.id}">${g.name}<span class="assunto-count">${plural(g.total, 'matéria', 'matérias')}</span></h3>
    <div class="assunto-body">
      <article class="assunto-main">
        ${img(main.image, 'assunto-img')}
        <div>
          ${headline(main, 'h4')}
          ${main.dek ? html`<p class="dek">${main.dek}</p>` : ''}
          ${proof(main)}
        </div>
      </article>
      ${rest.length ? html`<ul class="assunto-list">${join(rest.map((s) => html`<li>${headline(s, 'h4')}<p class="proof-mini">${relTime(s.updated)}</p></li>`))}</ul>` : ''}
    </div>
  </section>`;
}

function deskBlock(sec) {
  const items = sec.stories.map((s) => html`<li>${headline(s)}${s.dek ? html`<p class="dek dek-sm">${s.dek}</p>` : ''}</li>`);
  return html`<section class="desk" data-section="${sec.id}" aria-labelledby="desk-${sec.id}">
    <h3 id="desk-${sec.id}"><a href="#/s/${sec.id}">${sec.name}</a><a class="more" href="#/s/${sec.id}">Ver editoria</a></h3>
    ${items.length ? html`<ul>${join(items)}</ul>` : html`<p class="empty">As principais desta editoria já estão nos assuntos do dia.</p>`}
  </section>`;
}

function notesBlock(notes, { title = 'Notas rápidas', hint = 'Fatos que, por enquanto, só uma redação noticiou.', showSection = true } = {}) {
  const rows = notes.map((n) => html`<li data-section="${n.section}">
    <time datetime="${n.published}">${clockOrDay(n.published)}</time>
    <div>${showSection ? html`<span class="note-section">${sectionName(n.section)}</span>` : ''}<a href="${storyHref(n.id)}" data-story="${n.id}">${n.title}</a></div>
  </li>`);
  return html`<aside class="notes" aria-label="${title}">
    <h2>${title}</h2>
    <p class="hint">${hint}</p>
    ${rows.length ? html`<ol>${join(rows)}</ol>` : html`<p class="hint">Nenhuma nota no momento.</p>`}
  </aside>`;
}

function storyRow(s) {
  return html`<li class="story-row" data-section="${s.section}">
    <div>
      ${headline(s, 'h3')}
      ${s.dek ? html`<p class="dek">${s.dek}</p>` : ''}
      ${proof(s)}
    </div>
    ${img(s.image, 'thumb')}
  </li>`;
}

function emptyState(title, text) {
  return html`<div class="notice"><h2>${title}</h2><p>${text}</p></div>`;
}

function errorState(error) {
  return emptyState('Não deu para carregar o jornal', `${error.message}. Confira a internet e toque em recarregar.`);
}

// ---------- páginas ----------

function remember(d) {
  state.updatedAt = d.updatedAt;
  state.version = d.version;
}

async function renderFront() {
  const d = await data('capa.json');
  remember(d);
  if (!d.total) {
    view.innerHTML = emptyState('Preparando a primeira edição', 'O Panorama está lendo as notícias pela primeira vez. Leva cerca de meio minuto; a página se atualiza sozinha.').__html;
    return;
  }
  let highlights = '';
  if (d.assuntos.length) {
    highlights = html`<section class="band"><h2 class="band-title">Assuntos do dia</h2>${join(d.assuntos.map(assuntoBlock))}</section>`;
  } else if (d.destaques.length) {
    highlights = html`<section class="band"><h2 class="band-title">Destaques</h2>
      <ul class="destaques-grid">${join(d.destaques.map((s) => html`<li data-section="${s.section}">${kicker(s)}${headline(s)}${proof(s)}</li>`))}</ul>
    </section>`;
  }

  view.innerHTML = html`
    <h1 class="sr-only">Capa</h1>
    <div class="front-top">
      ${d.manchete ? mancheteBlock(d.manchete) : html`<div></div>`}
      ${notesBlock(d.notas)}
    </div>
    ${highlights}
    <section class="band"><h2 class="band-title">Editorias</h2><div class="desks-grid">${join(d.sections.map(deskBlock))}</div></section>
  `.__html;
}

async function renderSection(id, notesLimit = 30) {
  const d = await data(`editoria/${id}.json`);
  remember(d);
  d.notasTotal = d.notas.length;
  d.notas = d.notas.slice(0, notesLimit);
  const groups = d.assuntos.map((g) => html`<section class="topic">
    <h2 class="topic-name">${g.name}<span class="assunto-count">${plural(g.stories.length, 'matéria', 'matérias')}</span></h2>
    <ol class="story-list">${join(g.stories.map(storyRow))}</ol>
  </section>`);
  if (d.outras.length) {
    groups.push(html`<section class="topic"><h2 class="topic-name">${d.assuntos.length ? 'Outras notícias' : 'Notícias confirmadas'}</h2><ol class="story-list">${join(d.outras.map(storyRow))}</ol></section>`);
  }
  const more = d.notasTotal > d.notas.length ? html`<button type="button" class="more-btn" id="more-notes">Mostrar mais notas</button>` : '';
  const main = groups.length
    ? join(groups)
    : emptyState('Nenhuma matéria confirmada ainda', 'Quando duas redações noticiarem o mesmo fato desta editoria, ele aparece aqui. Enquanto isso, veja as notas rápidas.');

  view.innerHTML = html`
    <div class="page-head" data-section="${id}">
      <h1>${sectionName(id)}</h1>
      <p>${plural(d.total, 'matéria confirmada', 'matérias confirmadas')} e ${plural(d.notasTotal, 'nota rápida', 'notas rápidas')} das últimas 72 horas.</p>
    </div>
    <div class="section-layout" data-section="${id}">
      <div>${main}</div>
      <div>${notesBlock(d.notas, { hint: 'Noticiadas por uma redação só, até agora.', showSection: false })}${more}</div>
    </div>
  `.__html;
  $('#more-notes')?.addEventListener('click', () => {
    const y = window.scrollY;
    renderSection(id, notesLimit + 60).then(() => window.scrollTo(0, y));
  });
}

function noteRow(n) {
  return html`<li class="story-row is-note" data-section="${n.section}">
    <div>
      <p class="kicker"><span class="kicker-section">${sectionName(n.section)}</span><span class="kicker-topic">Nota rápida</span></p>
      ${headline(n, 'h3')}
      <p class="proof-mini">Noticiada por uma redação só, ${relTime(n.updated)}</p>
    </div>
  </li>`;
}

async function renderSearch(q) {
  $('#search-input').value = q;
  view.innerHTML = html`<div class="page-head"><h1>${q}</h1><p>Buscando…</p></div>`.__html;
  state.searchIndex ||= await data('busca.json');
  const terms = fold(q).split(/\s+/).filter((t) => t.length >= 2);
  // Cada termo precisa aparecer no começo de alguma palavra ("israel" acha "israelense").
  const patterns = terms.map((t) => new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  // Índices do arquivo (meses fechados), carregados uma vez por busca.
  if (!state.archiveIndex) {
    const months = (await data('arquivo/index.json').catch(() => ({ months: [] }))).months || [];
    const parts = await Promise.all(months.map((m) => data(`arquivo/indice/${m}.json`).catch(() => [])));
    state.archiveIndex = parts.flat().map((r) => ({ ...r, id: archiveId(r.dia, r.id), i: null }));
  }
  const matches = (r) => patterns.every((re) => re.test(fold(`${r.t} ${r.d || ''} ${r.a || ''} ${r.x || ''}`)));
  const recent = state.searchIndex.filter(matches);
  const older = state.archiveIndex.filter(matches).sort((a, b) => b.u.localeCompare(a.u));
  const hits = [...recent, ...older].slice(0, 120);
  const rows = hits.map((r) => (r.k === 's'
    ? storyRow({ id: r.id, title: r.t, dek: r.d, section: r.s, assunto: r.a, updated: r.u, confirmations: r.c, image: r.i })
    : noteRow({ id: r.id, title: r.t, section: r.s, updated: r.u })));
  const confirmed = hits.filter((r) => r.k === 's').length;
  const google = `https://news.google.com/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  const summary = hits.length
    ? `${plural(hits.length, 'notícia', 'notícias')}${older.length ? `, ${older.length} delas do arquivo` : ''}${confirmed ? `; ${plural(confirmed, 'confirmada', 'confirmadas')} por mais de um veículo` : ''}.`
    : 'Nenhuma notícia com esses termos no Panorama.';

  view.innerHTML = html`
    <div class="page-head"><h1>${q}</h1><p>${summary}</p></div>
    <div class="search-results">
      ${rows.length ? html`<ol class="story-list">${join(rows)}</ol>` : ''}
      <p><a class="more-btn" href="${google}" target="_blank" rel="noopener noreferrer">Procurar também na internet</a></p>
    </div>
  `.__html;
}

async function renderBackstage() {
  const d = await data('bastidores.json');
  remember(d);
  const nr = d.newsroom;
  const rows = d.outlets.map((o) => {
    const failing = o.feeds.filter((f) => !f.ok);
    const stale = o.feeds.filter((f) => f.stale);
    const fetched = o.feeds.map((f) => f.fetchedAt).filter(Boolean).sort().pop();
    let status = html`<span class="status-ok">Funcionando</span>`;
    if (!o.ok) status = html`<span class="status-err">Fora do ar</span><div class="hint">${failing[0]?.error || 'ainda não consultado'}</div>`;
    else if (failing.length) status = html`<span class="status-warn">${failing.length} de ${o.feeds.length} feeds com falha</span>`;
    else if (stale.length === o.feeds.length) status = html`<span class="status-warn">Sem notícias novas há mais de 24 h</span>`;
    return html`<tr>
      <td>${o.name}${o.lang === 'en' ? html`<div class="hint">em inglês</div>` : ''}</td>
      <td>${status}</td>
      <td class="num">${o.itemCount}</td>
      <td class="hint">${fetched ? relTime(fetched) : 'nunca'}</td>
    </tr>`;
  });
  const redacao = nr.enabled
    ? html`<p>Ligada, com o modelo <strong>${nr.model}</strong>. ${plural(nr.written, 'matéria escrita', 'matérias escritas')} no acervo; ${nr.today} de ${nr.dailyLimit} redações usadas hoje.${nr.running ? ' Escrevendo agora.' : ''}</p>
      ${nr.lastError ? html`<p class="status-err">Último erro: ${nr.lastError}</p>` : ''}`
    : html`<p>Desligada. As matérias aparecem com o título e o resumo originais de um dos veículos que noticiaram o fato.</p>`;

  const lock = state.key
    ? html`<section class="notice"><h2>Este aparelho</h2><p>O Panorama é privado e está liberado aqui com a sua senha.</p><button type="button" class="more-btn" id="forget-key">Sair deste aparelho</button></section>`
    : '';
  view.innerHTML = html`
    <div class="page-head"><h1>Bastidores</h1><p>Como o Panorama apura, e o estado de cada parte agora.</p></div>
    <div class="backstage">
      <section class="notice"><h2>Redação</h2>${redacao}
        <p>O Panorama lê ${d.outlets.length} veículos profissionais. Quando dois ou mais noticiam o mesmo fato, ele escreve uma matéria própria usando só o que essas reportagens trazem. Fatos de uma redação só ficam nas notas rápidas, com o título original.</p>
      </section>
      <section>
        <h2 class="band-title">Veículos lidos</h2>
        <div class="table-wrap"><table class="sources-table">
          <thead><tr><th>Veículo</th><th>Status</th><th>Reportagens</th><th>Última leitura</th></tr></thead>
          <tbody>${join(rows)}</tbody>
        </table></div>
      </section>
      ${lock}
    </div>
  `.__html;
  $('#forget-key')?.addEventListener('click', () => {
    forgetKey();
    location.reload();
  });
}

const fullDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (day) => fullDate.format(new Date(`${day}T12:00:00Z`));

// Matérias do arquivo têm id "AAAA-MM-DD~id": o detalhe vem do arquivo do dia.
const archiveId = (day, id) => `${day}~${id}`;
const archiveDays = new Map();

async function archiveDay(day) {
  if (!archiveDays.has(day)) archiveDays.set(day, await data(`arquivo/dias/${day}.json`));
  return archiveDays.get(day);
}

function entryToStory(e) {
  return { id: archiveId(e.day, e.id), title: e.title, dek: e.dek, section: e.section, assunto: e.assunto, updated: e.updated, confirmations: e.confirmations, image: e.image };
}

async function renderArchive(day) {
  if (!day) {
    const d = await data('arquivo/index.json');
    const rows = d.days.map((x) => html`<li>
      <a href="#/arquivo/${x.day}">${dayLabel(x.day)}</a>
      <span class="hint">${plural(x.stories, 'matéria', 'matérias')}, ${plural(x.notes, 'nota', 'notas')}${x.open ? ', em andamento' : ''}</span>
    </li>`);
    view.innerHTML = html`
      <div class="page-head"><h1>Arquivo</h1><p>Tudo o que passou pelo Panorama, guardado por dia. As matérias confirmadas ficam com o texto completo; as notas rápidas, com o título.</p></div>
      ${rows.length ? html`<ol class="archive-days">${join(rows)}</ol>` : emptyState('O arquivo ainda está vazio', 'Ele começa a ser preenchido na próxima atualização do Panorama.')}
    `.__html;
    return;
  }
  const d = await archiveDay(day);
  const sections = SECTIONS.map((sec) => {
    const mine = d.entries.filter((e) => e.section === sec.id);
    const stories = mine.filter((e) => e.k === 's').sort((a, b) => b.confirmations - a.confirmations);
    const notes = mine.filter((e) => e.k === 'n').sort((a, b) => b.updated.localeCompare(a.updated));
    if (!mine.length) return '';
    const topics = new Map();
    for (const e of stories) topics.set(e.assunto || '', [...(topics.get(e.assunto || '') || []), e]);
    const groups = [...topics.entries()].sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || b[1].length - a[1].length)
      .map(([name, list]) => html`${topics.size > 1 || name ? html`<h3 class="archive-topic">${name || 'Outras notícias'}</h3>` : ''}<ol class="story-list">${join(list.map((e) => storyRow(entryToStory(e))))}</ol>`);
    const notesList = notes.length
      ? html`<details class="archive-notes"><summary>${plural(notes.length, 'nota rápida', 'notas rápidas')}</summary><ol class="story-list">${join(notes.map((e) => noteRow({ id: archiveId(e.day, e.id), title: e.title, section: e.section, updated: e.updated })))}</ol></details>`
      : '';
    return html`<section class="topic" data-section="${sec.id}">
      <h2 class="topic-name">${sec.name}<span class="assunto-count">${plural(stories.length, 'matéria', 'matérias')}</span></h2>
      ${join(groups)}${notesList}
    </section>`;
  });
  const total = d.entries.filter((e) => e.k === 's').length;
  view.innerHTML = html`
    <div class="page-head"><h1>${dayLabel(day)}</h1><p>${plural(total, 'matéria confirmada', 'matérias confirmadas')}${d.open ? ', edição ainda em andamento' : ''}. <a href="#/arquivo">Ver outros dias</a></p></div>
    <div class="archive-day">${join(sections)}</div>
  `.__html;
}

// ---------- matéria ----------

async function openStory(id) {
  storyBody.innerHTML = '<p class="loading">Carregando…</p>';
  if (!storyDialog.open) storyDialog.showModal();
  let s;
  try {
    if (id.includes('~')) {
      const [day, key] = id.split('~');
      const e = (await archiveDay(day)).entries.find((x) => x.id === key);
      if (!e) throw Object.assign(new Error('Não encontrado'), { status: 404 });
      s = {
        ...entryToStory(e),
        published: e.published,
        written: false,
        resumo: [],
        corpo: e.corpo || null,
        originals: e.originals || (e.link ? [{ title: e.title, link: e.link, outlet: 'reportagem original', published: e.published }] : []),
        related: [],
      };
    } else {
      s = await data(`m/${encodeURIComponent(id)}.json`);
    }
  } catch (error) {
    storyBody.innerHTML = emptyState('Matéria indisponível', error.status === 404 ? 'Esta notícia saiu da edição atual. Procure pelo assunto na busca: ela continua no arquivo.' : error.message).__html;
    return;
  }

  let body = '';
  if (s.corpo) {
    body = html`<div class="article">${raw(s.corpo)}</div>`;
  } else if (s.written) {
    body = html`
      ${s.resumo.length ? html`<section class="resumo" aria-labelledby="resumo-t"><h2 id="resumo-t">Em resumo</h2><ul>${join(s.resumo.map((r) => html`<li>${r}</li>`))}</ul></section>` : ''}
      <div class="article">${join(s.texto.map((p) => html`<p>${p}</p>`))}</div>`;
  } else if (s.originals[0]) {
    body = html`<p><a class="more-btn" href="${s.originals[0].link}" target="_blank" rel="noopener noreferrer">Ler a reportagem completa</a></p>`;
  }

  const related = s.related?.length
    ? html`<section class="related"><h2>Mais sobre ${s.assunto}</h2><ul>${join(s.related.map((r) => html`<li>${headline(r, 'h3')}<p class="proof-mini">${relTime(r.updated)}</p></li>`))}</ul></section>`
    : '';

  const confirm = s.confirmations >= 2
    ? html`<span class="check" aria-hidden="true">${raw(checkIcon)}</span>Confirmado por ${s.confirmations} veículos.`
    : 'Noticiado por uma redação até agora.';
  const when = `Publicado ${relTime(s.published)}${s.updated !== s.published ? `, atualizado ${relTime(s.updated)}` : ''}.`;

  storyBody.innerHTML = html`
    <article class="story-detail" data-section="${s.section}">
      ${kicker(s, { link: false })}
      <h1 id="story-title">${s.title}</h1>
      ${s.dek ? html`<p class="dek dek-lg">${s.dek}</p>` : ''}
      <p class="story-meta">${confirm} ${when}</p>
      ${img(s.image, 'story-img', true)}
      ${body}
      ${related}
      <details class="originals">
        <summary>Conferir as ${plural(s.originals.length, 'reportagem original', 'reportagens originais')}</summary>
        <ul>${join(s.originals.map((o) => html`<li><a href="${o.link}" target="_blank" rel="noopener noreferrer">${o.title}</a><span class="hint">${o.outlet}, ${relTime(o.published)}</span></li>`))}</ul>
      </details>
    </article>
  `.__html;
  storyDialog.scrollTop = 0;
}

function closeStory() {
  if (storyDialog.open) storyDialog.close();
}
$('#story-close').addEventListener('click', closeStory);
storyDialog.addEventListener('click', (e) => {
  if (e.target === storyDialog) closeStory();
});
storyDialog.addEventListener('close', () => {
  if (location.hash.startsWith('#story=')) history.back();
});

// ---------- indicadores ----------

const numFmt = (v, d) => v.toLocaleString('pt-BR', { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d });

async function renderIndicators() {
  const box = $('#indicators');
  try {
    const ind = await data('indicadores.json');
    const parts = ind.items.filter((i) => !i.error).map((i) => {
      const value = i.unit === 'R$' ? `R$ ${numFmt(i.value, i.decimals)}` : `${numFmt(i.value, i.decimals)}%`;
      let delta = '';
      if (i.previous && i.unit === 'R$') {
        const pct = ((i.value - i.previous.value) / i.previous.value) * 100;
        delta = html`<span class="delta ${pct >= 0 ? 'up' : 'down'}" title="Variação sobre ${i.previous.date.split('-').reverse().join('/')}">${pct >= 0 ? '▲' : '▼'} ${numFmt(Math.abs(pct), 2)}%</span>`;
      }
      const date = i.date.split('-').reverse().join('/');
      return html`<span class="indicator" title="${i.note}, referência ${date}">${i.name} <strong>${value}</strong>${delta} <span class="hint">${i.id === 'ipca' ? '12 meses' : date.slice(0, 5)}</span></span>`;
    });
    box.innerHTML = parts.length ? html`${join(parts)}<span class="credit">Dados oficiais do Banco Central</span>`.__html : '';
  } catch {
    box.innerHTML = '';
  }
}

// ---------- navegação ----------

function renderNav(active) {
  // O Arquivo só aparece no menu quando a redação já guardou matérias de dias anteriores.
  const extra = state.hasArchive ? [{ id: 'arquivo', name: 'Arquivo' }] : [];
  const links = [{ id: '', name: 'Capa' }, ...state.meta.sections, ...extra].map((s) => {
    const href = s.id === '' ? '#/' : s.id === 'arquivo' ? '#/arquivo' : `#/s/${s.id}`;
    return html`<a href="${href}" data-section="${s.id}" ${raw(active === s.id ? 'aria-current="page"' : '')}>${s.name}</a>`;
  });
  $('#sections').innerHTML = join(links).__html;
}

function parseRoute() {
  const hash = location.hash || '#/';
  if (hash.startsWith('#story=')) return { name: 'story', id: hash.slice(7) };
  const [, kind, arg] = hash.match(/^#\/([^/]*)\/?(.*)$/) || [];
  if (kind === 's' && SECTIONS.some((s) => s.id === arg)) return { name: 'section', id: arg };
  if (kind === 'busca' && arg) return { name: 'search', q: decodeURIComponent(arg) };
  if (kind === 'bastidores') return { name: 'backstage' };
  if (kind === 'arquivo') return { name: 'archive', day: /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : null };
  return { name: 'front' };
}

let lastPage = null;

async function route() {
  const r = parseRoute();
  if (r.name === 'story') {
    if (!lastPage) await renderPage({ name: 'front' });
    openStory(r.id);
    return;
  }
  closeStory();
  await renderPage(r);
}

async function renderPage(r) {
  const key = JSON.stringify(r);
  const samePage = lastPage === key;
  lastPage = key;
  renderNav(r.name === 'section' ? r.id : r.name === 'front' ? '' : r.name === 'archive' ? 'arquivo' : null);
  if (r.name !== 'search') $('#search-input').value = '';
  try {
    if (r.name === 'section') await renderSection(r.id);
    else if (r.name === 'search') await renderSearch(r.q);
    else if (r.name === 'backstage') await renderBackstage();
    else if (r.name === 'archive') await renderArchive(r.day);
    else await renderFront();
    if (!state.version) remember(await data('versao.json').catch(() => ({})));
    state.renderedVersion = state.version;
    $('#fresh-pill').hidden = true;
  } catch (error) {
    view.innerHTML = errorState(error).__html;
  }
  if (!samePage) window.scrollTo(0, 0);
  updateClock();
}

const currentPage = () => {
  const r = parseRoute();
  return r.name === 'story' ? JSON.parse(lastPage) : r;
};

// Abre a matéria no painel sem sair da página atual.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-story]');
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  if (location.hash !== `#story=${a.dataset.story}`) location.hash = `story=${a.dataset.story}`;
  else openStory(a.dataset.story);
});

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  if (q.length >= 2) location.hash = `#/busca/${encodeURIComponent(q)}`;
});

// ---------- atualização ----------

function updateClock() {
  $('#dateline').textContent = longDate.format(new Date());
  $('#updated').textContent = state.updatedAt ? `Atualizado ${relTime(state.updatedAt)}` : 'Preparando a edição…';
}

async function poll() {
  try {
    const v = await data('versao.json');
    if (v.version && v.version !== state.renderedVersion) {
      state.updatedAt = v.updatedAt;
      state.searchIndex = null;
      state.archiveIndex = null;
      archiveDays.clear();
      const page = currentPage();
      const emptyFront = page.name === 'front' && !document.querySelector('.manchete');
      // Na capa vazia, ou no topo da capa sem matéria aberta, atualiza direto; senão avisa.
      if (emptyFront || (page.name === 'front' && window.scrollY < 200 && !storyDialog.open)) await renderPage(page);
      else $('#fresh-pill').hidden = false;
    }
  } catch {
    /* sem conexão: segue mostrando a edição atual */
  }
  updateClock();
}

$('#fresh-pill').addEventListener('click', () => renderPage(currentPage()));

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 4000);
}

$('#refresh-btn').addEventListener('click', async () => {
  const btn = $('#refresh-btn');
  btn.classList.add('spinning');
  const before = state.renderedVersion;
  try {
    const v = await data('versao.json');
    state.version = v.version;
    state.updatedAt = v.updatedAt;
    state.searchIndex = null;
    state.archiveIndex = null;
    archiveDays.clear();
    // Da busca, atualizar leva de volta à capa (com a barra de busca limpa).
    const page = currentPage();
    if (page.name === 'search') location.hash = '#/';
    else await renderPage(page);
    renderIndicators();
    toast(v.version !== before ? 'Edição nova carregada.' : `Você já está na edição mais recente, publicada ${relTime(v.updatedAt)}.`);
  } catch (error) {
    toast(`Não deu para atualizar: ${error.message}.`);
  } finally {
    btn.classList.remove('spinning');
  }
});

// ---------- tema ----------

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
try {
  applyTheme(localStorage.getItem('panorama:theme'));
} catch {
  /* sem armazenamento: segue o sistema */
}
$('#theme-btn').addEventListener('click', () => {
  const current = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem('panorama:theme', next);
  } catch {
    /* ignora */
  }
});

// ---------- início ----------

/** Tela de senha do app privado. Resolve quando a senha certa for digitada. */
function askPassword() {
  document.body.classList.add('locked');
  view.innerHTML = html`<form class="lock" id="lock-form">
    <h1>Panorama</h1>
    <p>Este jornal é privado. Digite a sua frase-senha para abrir. Ela fica guardada neste aparelho.</p>
    <label class="sr-only" for="lock-pass">Frase-senha</label>
    <input id="lock-pass" type="password" autocomplete="current-password" placeholder="Frase-senha" required>
    <button type="submit">Abrir o jornal</button>
    <p class="lock-error" id="lock-error" role="alert"></p>
  </form>`.__html;
  const form = $('#lock-form');
  $('#lock-pass').focus();
  return new Promise((done) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Conferindo…';
      $('#lock-error').textContent = '';
      const key = await unlock($('#lock-pass').value);
      if (key) {
        document.body.classList.remove('locked');
        done(key);
      } else {
        $('#lock-error').textContent = 'Senha incorreta. Confira maiúsculas, acentos e espaços.';
        btn.disabled = false;
        btn.textContent = 'Abrir o jornal';
      }
    });
  });
}

async function init() {
  updateClock();
  // Edição privada? O descritor é o único arquivo em aberto.
  try {
    const res = await fetch('data/cripto.json', { cache: 'no-cache' });
    if (res.ok) state.cripto = await res.json();
  } catch {
    /* offline: tenta com o que estiver guardado */
  }
  if (state.cripto) state.key = (await storedKey()) || (await askPassword());
  state.hasArchive = ((await data('arquivo/index.json').catch(() => ({ days: [] }))).days || []).length > 0;
  state.archiveIndex = null;
  window.addEventListener('hashchange', route);
  await route();
  renderIndicators();
  setInterval(poll, 60e3);
  document.addEventListener('visibilitychange', () => {
    // Ao voltar para o app, confere se saiu edição nova.
    if (document.visibilityState === 'visible') poll();
  });
  setInterval(renderIndicators, 30 * 60e3);
}

init();
