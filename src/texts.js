// Texto integral das reportagens de veículos abertos, extraído uma vez por reportagem e
// guardado junto com o acervo. Só é publicado quando a edição sai criptografada (app privado).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { JSDOM } from 'jsdom';
import { extractArticle } from './reader.js';
import { mapLimit } from './fetcher.js';

// Veículos cujo texto sai mais limpo na extração vêm primeiro; os demais, pelo tamanho do texto.
const PREFERRED = ['agenciabrasil', 'g1', 'ge', 'bbcbrasil', 'cnn', 'uol', 'poder360', 'metropoles', 'dw', 'rfi', 'infomoney', 'exame', 'jovempan', 'cartacapital', 'canaltech', 'bcb'];
const MIN_GOOD_LENGTH = 800;

// Restos de página que não são a reportagem: players de vídeo, chamadas, créditos do site.
const NOISE = [
  /^\s*(play|assista|ouça|leia (também|mais)|veja (também|mais)|saiba mais|siga .{0,40} no|inscreva-se|compartilhe|publicidade|continua após)/i,
  /\(\d{1,2}:\d{2}\)/,
  /\b[\w-]+\.com(\.br)?\b.{0,40}$/i,
];

/** Remove blocos curtos que são ruído de página, mantendo parágrafos e imagens da reportagem. */
export function cleanBody(html) {
  const { document } = new JSDOM(`<body>${html}</body>`).window;
  for (const el of document.body.querySelectorAll('p, div, span, li, h2, h3, h4, figcaption, a')) {
    if (!el.isConnected || el.querySelector('img')) continue;
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    if (text.length < 140 && NOISE.some((re) => re.test(text))) el.remove();
  }
  return document.body.innerHTML;
}

export class TextStore {
  constructor({ log = console } = {}) {
    this.log = log;
    this.texts = new Map(); // itemId -> { html, length } | { none: true } (página sem texto legível)
  }

  get size() {
    return [...this.texts.values()].filter((t) => t.html).length;
  }

  get(itemId) {
    const t = this.texts.get(itemId);
    return t?.html ? t : null;
  }

  toJSON() {
    return Object.fromEntries(this.texts);
  }

  fromJSON(data) {
    this.texts = new Map(Object.entries(data || {}));
  }

  async loadFile(path) {
    try {
      this.fromJSON(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') this.log.warn?.(`Textos salvos ignorados (${error.message}).`);
    }
  }

  async saveFile(path) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(this));
  }

  /**
   * Garante um texto completo por fato, começando pelos mais importantes: primeiro as
   * matérias confirmadas (na ordem da capa), depois as notas rápidas, das mais novas às mais
   * antigas. De cada fato, lê só a reportagem do veículo com extração mais limpa; se ela não
   * render texto, a próxima rodada tenta outro veículo. Até `limit` leituras por rodada.
   */
  async fill(store, { limit = 300, concurrency = 8 } = {}) {
    for (const id of this.texts.keys()) if (!store.getItem(id)) this.texts.delete(id);
    const preference = (i) => {
      const p = PREFERRED.indexOf(i.outletId);
      return p === -1 ? PREFERRED.length : p;
    };
    const stories = store.query({ limit: Infinity }).filter((c) => c.outletCount >= 2);
    const notes = store.query({ limit: Infinity, order: 'recent' }).filter((c) => c.outletCount < 2);
    const pending = [];
    for (const cluster of [...stories, ...notes]) {
      if (pending.length >= limit) break;
      if (this.bestFor(cluster)) continue;
      const next = cluster.items.filter((i) => i.readable && !this.texts.has(i.id)).sort((a, b) => preference(a) - preference(b))[0];
      if (next) pending.push(next);
    }
    let ok = 0;
    await mapLimit(pending, concurrency, async (item) => {
      const a = await extractArticle(item).catch(() => null);
      if (a?.ok) {
        this.texts.set(item.id, { html: cleanBody(a.content), length: a.length, outlet: item.outletId });
        ok++;
      } else if (a && a.reason !== 'erro') {
        this.texts.set(item.id, { none: true });
      }
      // Em erro de rede, não marca nada: tenta de novo na próxima rodada.
    });
    if (pending.length) this.log.info?.(`Textos completos: ${ok} de ${pending.length} leituras deram certo (${this.size} guardados).`);
    return ok;
  }

  /** Melhor texto do grupo: de um veículo com extração limpa, ou o mais completo. */
  bestFor(cluster) {
    const options = cluster.items.map((i) => ({ i, t: this.get(i.id) })).filter((o) => o.t);
    if (!options.length) return null;
    const rank = (o) => {
      const p = PREFERRED.indexOf(o.i.outletId);
      return o.t.length >= MIN_GOOD_LENGTH && p !== -1 ? p : PREFERRED.length + 1;
    };
    options.sort((a, b) => rank(a) - rank(b) || b.t.length - a.t.length);
    return options[0].t;
  }
}
