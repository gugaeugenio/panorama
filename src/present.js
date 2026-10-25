// Monta o jornal: transforma grupos de reportagens em matérias do Panorama e as organiza em
// manchete, assuntos do dia, editorias e notas rápidas. Nenhum nome de veículo sai daqui,
// exceto na lista de reportagens originais do detalhe da matéria (para conferência).

import { SECTIONS } from './sources.js';
import { score } from './cluster.js';
import { dayOf } from './newsroom.js';

/** Fato confirmado: publicado por 2+ veículos, ou já transformado em matéria. */
// Fatos em inglês só entram depois de redigidos em português.
const isStory = (c, newsroom) => (c.lead.lang === 'pt' && c.outletCount >= 2) || !!newsroom.articleFor(c)?.apto;

export function toStory(cluster, newsroom, { detail = false } = {}) {
  const article = newsroom.articleFor(cluster);
  const written = !!article?.apto;
  const image = cluster.items.find((i) => i.image)?.image || null;
  const story = {
    id: cluster.id,
    section: written ? article.editoria : cluster.section,
    assunto: written ? article.assunto || null : null,
    title: written ? article.titulo : cluster.lead.title,
    dek: written ? article.linhaFina : cluster.lead.summary || '',
    image,
    published: cluster.first,
    updated: cluster.latest,
    confirmations: cluster.outletCount,
    written,
  };
  if (detail) {
    Object.assign(story, {
      resumo: written ? article.emResumo : [],
      texto: written ? article.texto : [],
      writtenAt: written ? article.writtenAt : null,
      // Fato ainda não redigido: o leitor pode abrir o texto integral de uma reportagem aberta.
      readableItemId: written ? null : cluster.items.find((i) => i.readable)?.id || null,
      originals: cluster.items.map((i) => ({ title: i.title, link: i.link, outlet: i.outletName, published: i.published })),
    });
  }
  return story;
}

function toNote(cluster) {
  return { id: cluster.id, section: cluster.section, title: cluster.lead.title, published: cluster.lead.published };
}

function groupByAssunto(stories, scores) {
  const groups = new Map();
  for (const s of stories) {
    if (!s.assunto) continue;
    if (!groups.has(s.assunto)) groups.set(s.assunto, { name: s.assunto, stories: [], weight: 0 });
    const g = groups.get(s.assunto);
    g.stories.push(s);
    g.weight += scores.get(s.id) || 0;
  }
  return [...groups.values()].sort((a, b) => b.weight - a.weight);
}

/** Classifica os grupos do acervo em matérias e notas, já ordenados por relevância. */
function split(store, newsroom, now = Date.now()) {
  const stories = [];
  const notes = [];
  const scores = new Map();
  for (const c of store.query({ limit: Infinity })) {
    if (isStory(c, newsroom)) {
      const s = toStory(c, newsroom);
      scores.set(s.id, score(c, now));
      stories.push(s);
    } else if (c.lead.lang === 'pt') {
      notes.push(toNote(c));
    }
  }
  notes.sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
  return { stories, notes, scores };
}

export function buildFront(store, newsroom) {
  const { stories, notes, scores } = split(store, newsroom);
  const [manchete, ...rest] = stories;
  const used = new Set(manchete ? [manchete.id] : []);

  // Assuntos do dia: temas com 2+ matérias, cada um com sua principal e as relacionadas.
  const assuntos = groupByAssunto(rest, scores)
    .filter((g) => g.stories.length >= 2)
    .slice(0, 5)
    .map((g) => {
      const list = g.stories.slice(0, 5);
      list.forEach((s) => used.add(s.id));
      return { name: g.name, total: g.stories.length, stories: list };
    });

  // Sem redação ativa não há assuntos: os destaques ocupam esse espaço.
  const destaques = assuntos.length ? [] : rest.slice(0, 6);
  destaques.forEach((s) => used.add(s.id));

  const sections = SECTIONS.map((sec) => ({
    ...sec,
    stories: rest.filter((s) => s.section === sec.id && !used.has(s.id)).slice(0, 4),
  }));

  return { manchete: manchete || null, assuntos, destaques, sections, notas: notes.slice(0, 8) };
}

export function buildSection(store, newsroom, sectionId, { notesLimit = 30 } = {}) {
  const { stories, notes, scores } = split(store, newsroom);
  const mine = stories.filter((s) => s.section === sectionId);
  const assuntos = groupByAssunto(mine, scores).map((g) => ({ name: g.name, stories: g.stories }));
  const outras = mine.filter((s) => !s.assunto);
  const sectionNotes = notes.filter((n) => n.section === sectionId);
  return { assuntos, outras, notas: sectionNotes.slice(0, notesLimit), notasTotal: sectionNotes.length, total: mine.length };
}

/** Matéria guardada no arquivo, para quando as reportagens originais já saíram do acervo. */
function fromArticle(a, { detail = false } = {}) {
  const story = {
    id: a.key,
    section: a.editoria,
    assunto: a.assunto || null,
    title: a.titulo,
    dek: a.linhaFina,
    image: a.image || null,
    published: a.published || a.writtenAt,
    updated: a.updated || a.published || a.writtenAt,
    confirmations: a.outletCount,
    written: true,
  };
  if (detail) Object.assign(story, { resumo: a.emResumo, texto: a.texto, writtenAt: a.writtenAt, readableItemId: null, originals: a.originals || [] });
  return story;
}

const byNewest = (a, b) => Date.parse(b.published || b.writtenAt) - Date.parse(a.published || a.writtenAt);
const written = (newsroom) => [...newsroom.articles.values()].filter((a) => a.apto);

export function buildStory(store, newsroom, id) {
  const cluster = store.getCluster(id);
  let story;
  let ownKey = null;
  if (cluster) {
    story = toStory(cluster, newsroom, { detail: true });
    const article = newsroom.articleFor(cluster);
    ownKey = article?.key || null;
    // A matéria guarda também reportagens que já saíram do acervo.
    if (article?.apto && article.originals?.length > story.originals.length) story.originals = article.originals;
  } else {
    const article = newsroom.articles.get(id);
    if (!article?.apto) return null;
    story = fromArticle(article, { detail: true });
    ownKey = article.key;
  }
  // "Mais sobre o assunto": as matérias mais recentes do mesmo tema, inclusive de dias anteriores.
  const related = story.assunto
    ? written(newsroom).filter((a) => a.assunto === story.assunto && a.key !== ownKey).sort(byNewest).slice(0, 6).map((a) => fromArticle(a))
    : [];
  return { ...story, related };
}

/** Dias que têm matérias no arquivo, do mais recente para o mais antigo. */
export function buildArchiveDays(newsroom) {
  const days = new Map();
  for (const a of written(newsroom)) {
    const d = dayOf(a.published || a.writtenAt);
    days.set(d, (days.get(d) || 0) + 1);
  }
  return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, count]) => ({ day, count }));
}

/** Edição de um dia: matérias por editoria e, dentro dela, por assunto. */
export function buildArchiveDay(newsroom, day) {
  const list = written(newsroom)
    .filter((a) => dayOf(a.published || a.writtenAt) === day)
    .sort((a, b) => b.outletCount - a.outletCount || byNewest(a, b))
    .map((a) => fromArticle(a));
  const sections = SECTIONS.map((sec) => {
    const mine = list.filter((s) => s.section === sec.id);
    const groups = new Map();
    for (const s of mine) if (s.assunto) groups.set(s.assunto, [...(groups.get(s.assunto) || []), s]);
    return {
      ...sec,
      total: mine.length,
      assuntos: [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([name, stories]) => ({ name, stories })),
      outras: mine.filter((s) => !s.assunto),
    };
  }).filter((sec) => sec.total);
  return { day, total: list.length, sections };
}
