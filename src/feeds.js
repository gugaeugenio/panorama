// Converte o XML de um feed (RSS 0.91/1.0/2.0 ou Atom) em itens normalizados.

import Parser from 'rss-parser';
import { stripHtml, truncate, hashId, fold } from './text.js';
import { classify, override } from './classify.js';

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail'],
      ['dc:date', 'dcDate'],
      ['source', 'source'],
    ],
  },
});

export const MAX_AGE_HOURS = 72;

// Páginas que não são notícia: vídeos soltos, transmissões e serviço ("onde assistir").
const NOISE_TITLE = /^(v[ií]deos?|assista|podcast|ao vivo)\b|\b(ao vivo|melhores momentos|onde assistir|veja os gols)\b/i;
const NOISE_LINK = /\/(playlist|videos?|podcasts?|ao-vivo)\//i;

export const isNoise = (title, link) => NOISE_TITLE.test(title) || NOISE_LINK.test(link);

/** Folha embrulha links em um redirecionador: ".../redir/...*https://www1.folha..." */
export function cleanLink(link = '') {
  let url = link.trim();
  const star = url.indexOf('*http');
  if (star !== -1) url = url.slice(star + 1);
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|xtor|at_|cmpid|ref$|fbclid|gclid)/i.test(key)) u.searchParams.delete(key);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return '';
  }
}

function pickImage(raw) {
  const candidates = [];
  if (raw.enclosure?.url && /image|jpe?g|png|webp/i.test(raw.enclosure.type || raw.enclosure.url)) {
    candidates.push(raw.enclosure.url);
  }
  for (const m of raw.mediaContent || []) {
    const url = m?.$?.url;
    if (url && (!m.$.medium || m.$.medium === 'image') && !/\.(mp4|m3u8|mp3)/i.test(url)) candidates.push(url);
  }
  if (raw.mediaThumbnail?.$?.url) candidates.push(raw.mediaThumbnail.$.url);
  const html = raw['content:encoded'] || raw.content || '';
  const inline = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  if (inline) candidates.push(inline[1]);
  const found = candidates.find((u) => /^https?:\/\//.test(u));
  return found ? found.replace(/^http:\/\//, 'https://') : null;
}

function pickDate(raw) {
  const value = raw.isoDate || raw.pubDate || raw.dcDate || raw.updated;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function pickSummary(raw, title) {
  const source = raw.contentSnippet || raw.summary || raw.content || raw.description || '';
  let text = stripHtml(source)
    .replace(/\b(Continue lendo|Leia mais|Read more|Ler mais)\b.*$/i, '')
    .replace(/The post .* appeared first on .*$/i, '')
    .replace(/O post .* apareceu primeiro em .*$/i, '')
    .trim();
  // Alguns feeds repetem o título como resumo; isso não acrescenta informação.
  if (fold(text).startsWith(fold(title)) && text.length < title.length + 15) text = '';
  return text ? truncate(text, 360) : '';
}

function pickCategories(raw) {
  const list = Array.isArray(raw.categories) ? raw.categories : [];
  return list.map((c) => (typeof c === 'string' ? c : c?._ || '')).filter(Boolean);
}

/**
 * @returns {{title: string, items: object[]}}
 */
/** O rss-parser recusa <rss> sem o atributo version (caso do UOL). */
function repair(xml) {
  return xml.replace(/<rss(\s*)>/i, '<rss version="2.0"$1>');
}

export async function parseFeed(xml, { outlet, feed, now = new Date() }) {
  const parsed = await parser.parseString(repair(xml));
  const minDate = now.getTime() - MAX_AGE_HOURS * 3600e3;
  const maxDate = now.getTime() + 2 * 3600e3; // tolera relógios levemente adiantados
  const items = [];

  for (const raw of parsed.items || []) {
    const title = stripHtml(raw.title || '');
    const link = cleanLink(raw.link || raw.guid || '');
    const published = pickDate(raw);
    if (!title || !link || !published || isNoise(title, link)) continue;
    const t = published.getTime();
    if (t < minDate || t > maxDate) continue;

    const categories = pickCategories(raw);
    items.push({
      id: hashId(link),
      title,
      summary: pickSummary(raw, title),
      link,
      image: pickImage(raw),
      published: published.toISOString(),
      outletId: outlet.id,
      outletName: outlet.name,
      lang: outlet.lang,
      readable: outlet.readable,
      section: override(title, feed.section === 'auto' ? classify({ link, categories, title, fallback: feed.fallback }) : feed.section),
    });
  }
  return { title: parsed.title || outlet.name, items };
}
