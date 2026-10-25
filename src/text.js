// Utilitários de texto compartilhados por parser, agrupamento e busca.

import { createHash } from 'node:crypto';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’' };

export function decodeEntities(str) {
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Remove tags e entidades, colapsa espaços. */
export function stripHtml(html = '') {
  const noTags = String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(noTags).replace(/\s+/g, ' ').trim();
}

export function truncate(str, max) {
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).replace(/[\s,;:.–-]+$/, '')}…`;
}

/** Minúsculas, sem acentos e sem pontuação. */
export function fold(str = '') {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set(`
a o as os um uma uns umas de do da dos das no na nos nas em ao aos à às por pelo pela pelos pelas para pra
com sem sob sobre entre ate apos antes desde contra e ou mas que se como quando onde quem qual quais
seu sua seus suas ele ela eles elas isso esse essa este esta aquele aquela nao sim ja mais menos muito
ser ter foi sao era vai vao diz dizem afirma apos tem faz fazer pode podem deve devem esta estao
the of and to in on for with at by from as is are was be after over into its it that this new says
veja ao vivo entenda saiba video fotos assista leia
`.split(/\s+/).filter(Boolean));

/** Tokens significativos de um título, para comparar fatos entre veículos. */
export function tokens(str) {
  const out = new Set();
  // Siglas de 2 letras (DF, SP, PT, EUA...) só são reconhecíveis antes de baixar a caixa.
  for (const m of String(str).matchAll(/\b[A-Z]{2}\b/g)) out.add(m[0].toLowerCase());
  // "50,8%" vira o token "50d8" para não se confundir com "50" ou "8".
  const prepared = String(str).replace(/(\d+)[.,](\d+)/g, '$1d$2');
  for (let w of fold(prepared).split(' ')) {
    if (!w || STOPWORDS.has(w)) continue;
    if (/^\d/.test(w)) {
      if (w.length >= 2) out.add(w);
      continue;
    }
    if (w.length < 3) continue;
    // Plural simples: "eleicoes"/"eleicao" ainda divergem, mas "deputados"/"deputado" casam.
    if (w.length > 4 && w.endsWith('s')) w = w.slice(0, -1);
    out.add(w);
  }
  return out;
}

export const isNumberToken = (t) => /^\d/.test(t);

export function hashId(str) {
  return createHash('sha1').update(str).digest('hex').slice(0, 16);
}
