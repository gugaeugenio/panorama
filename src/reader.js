// Modo leitura: extrai o texto da página original com Mozilla Readability.
// Só é usado para veículos de acesso aberto (outlet.readable). Nunca contorna paywall:
// se a página não traz o texto completo, o leitor é mandado para o site do veículo.

import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { fetchText } from './fetcher.js';

const ALLOWED_TAGS = new Set(['P', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION', 'IMG', 'A', 'STRONG', 'EM', 'B', 'I', 'BR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'SPAN', 'DIV', 'SECTION', 'ARTICLE']);
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SVG', 'NOSCRIPT', 'VIDEO', 'AUDIO']);
const MIN_TEXT = 600;
const CACHE_MAX = 200;
const cache = new Map();

function sanitize(html, baseUrl) {
  const dom = new JSDOM(`<body>${html}</body>`, { url: baseUrl });
  const { document } = dom.window;

  const walk = (node) => {
    for (const child of [...node.children]) {
      if (DROP_TAGS.has(child.tagName)) {
        child.remove();
        continue;
      }
      walk(child);
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...child.childNodes);
        continue;
      }
      for (const attr of [...child.attributes]) {
        const keep = (child.tagName === 'A' && attr.name === 'href') || (child.tagName === 'IMG' && ['src', 'alt'].includes(attr.name));
        if (!keep) child.removeAttribute(attr.name);
      }
      if (child.tagName === 'A') {
        const href = child.href;
        if (!/^https?:/.test(href)) child.removeAttribute('href');
        else {
          child.setAttribute('href', href);
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noopener noreferrer');
        }
      }
      if (child.tagName === 'IMG') {
        const src = child.src;
        if (!/^https?:/.test(src)) child.remove();
        else {
          child.setAttribute('src', src);
          child.setAttribute('loading', 'lazy');
        }
      }
    }
  };
  walk(document.body);
  // Remove parágrafos vazios que sobram de blocos de publicidade.
  for (const p of document.querySelectorAll('p, div, span')) if (!p.textContent.trim() && !p.querySelector('img')) p.remove();
  return document.body.innerHTML;
}

/**
 * @returns {Promise<{ok: true, title, byline, content, length, siteName} | {ok: false, reason}>}
 */
export async function extractArticle(item) {
  if (!item.readable) return { ok: false, reason: 'paywall' };
  if (cache.has(item.link)) return cache.get(item.link);

  let result;
  try {
    const { text, finalUrl } = await fetchText(item.link, { timeoutMs: 15000, accept: 'text/html' });
    const virtualConsole = new VirtualConsole(); // silencia erros de CSS das páginas
    const dom = new JSDOM(text, { url: finalUrl, virtualConsole });
    const article = new Readability(dom.window.document, { charThreshold: 400 }).parse();
    if (!article || (article.textContent || '').trim().length < MIN_TEXT) {
      result = { ok: false, reason: 'sem-texto' };
    } else {
      result = {
        ok: true,
        title: article.title || item.title,
        byline: article.byline || null,
        siteName: article.siteName || item.outletName,
        length: article.textContent.trim().length,
        text: article.textContent.replace(/\s+/g, ' ').trim(),
        content: sanitize(article.content, finalUrl),
      };
    }
  } catch (error) {
    result = { ok: false, reason: 'erro', detail: error.message };
  }

  if (result.ok || result.reason === 'sem-texto') {
    cache.set(item.link, result);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  return result;
}
