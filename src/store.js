// Mantém o acervo em memória, atualiza os feeds periodicamente e persiste em data/cache.json.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { OUTLETS } from './sources.js';
import { fetchText, mapLimit } from './fetcher.js';
import { parseFeed, isNoise, MAX_AGE_HOURS } from './feeds.js';
import { buildClusters, dedupe, score } from './cluster.js';
import { override } from './classify.js';

const STALE_FEED_HOURS = 24;

export class NewsStore {
  constructor({ cachePath, refreshMinutes = 10, concurrency = 6, log = console, onRefresh } = {}) {
    this.onRefresh = onRefresh;
    this.cachePath = cachePath;
    this.refreshMs = refreshMinutes * 60e3;
    this.concurrency = concurrency;
    this.log = log;
    this.items = new Map();
    this.feedStatus = new Map(); // url -> { ok, error, fetchedAt, itemCount, newest }
    this.clusters = [];
    this.clusterByItem = new Map();
    this.updatedAt = null;
    this.refreshing = null;
    this.timer = null;
  }

  async load() {
    if (!this.cachePath) return;
    try {
      const data = JSON.parse(await readFile(this.cachePath, 'utf8'));
      // Reaplica os ajustes de editoria: o cache pode ter sido gravado por uma versão anterior.
      for (const item of data.items || []) {
        if (!isNoise(item.title, item.link)) this.items.set(item.id, { ...item, section: override(item.title, item.section) });
      }
      for (const [url, status] of Object.entries(data.feedStatus || {})) this.feedStatus.set(url, status);
      this.updatedAt = data.updatedAt || null;
      this.prune();
      this.rebuild();
      this.log.info?.(`Acervo carregado do disco: ${this.items.size} matérias.`);
    } catch (error) {
      if (error.code !== 'ENOENT') this.log.warn?.(`Cache ignorado (${error.message}).`);
    }
  }

  async save() {
    if (!this.cachePath) return;
    try {
      await mkdir(dirname(this.cachePath), { recursive: true });
      const tmp = `${this.cachePath}.tmp`;
      const body = { updatedAt: this.updatedAt, items: [...this.items.values()], feedStatus: Object.fromEntries(this.feedStatus) };
      await writeFile(tmp, JSON.stringify(body));
      await rename(tmp, this.cachePath);
    } catch (error) {
      this.log.warn?.(`Não foi possível salvar o cache: ${error.message}`);
    }
  }

  start() {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), this.refreshMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Atualiza todos os feeds. Chamadas simultâneas compartilham a mesma execução. */
  refresh() {
    if (!this.refreshing) {
      this.refreshing = this.#refreshAll().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async #refreshAll() {
    const started = Date.now();
    const jobs = OUTLETS.flatMap((outlet) => outlet.feeds.map((feed) => ({ outlet, feed })));
    let added = 0;
    const lags = []; // minutos entre a publicação no veículo e a chegada ao Panorama

    await mapLimit(jobs, this.concurrency, async ({ outlet, feed }) => {
      const status = { outletId: outlet.id, fetchedAt: new Date().toISOString() };
      try {
        const { text } = await fetchText(feed.url, { conditional: true, accept: 'application/rss+xml, application/xml, text/xml, */*' });
        const { items } = await parseFeed(text, { outlet, feed });
        for (const item of items) {
          if (!this.items.has(item.id)) {
            added++;
            lags.push((started - Date.parse(item.published)) / 60e3);
          }
          const existing = this.items.get(item.id);
          // Se a matéria já veio de um feed temático, não deixa o feed geral sobrescrever a editoria.
          if (existing && feed.section === 'auto') continue;
          this.items.set(item.id, item);
        }
        const newest = items.reduce((max, i) => (i.published > max ? i.published : max), '');
        Object.assign(status, { ok: true, itemCount: items.length, newest: newest || null });
      } catch (error) {
        Object.assign(status, { ok: false, error: error.message, itemCount: 0 });
      }
      this.feedStatus.set(feed.url, status);
    });

    this.prune();
    this.rebuild();
    this.updatedAt = new Date().toISOString();
    await this.save();
    const failed = [...this.feedStatus.values()].filter((s) => !s.ok).length;
    // Na primeira rodada tudo é "novo"; o atraso só faz sentido a partir da segunda.
    const recent = this.warm ? lags.filter((m) => m >= 0).sort((a, b) => a - b) : [];
    const lag = recent.length ? `, atraso mediano ${recent[Math.floor(recent.length / 2)].toFixed(1)} min` : '';
    this.warm = true;
    this.log.info?.(`Atualizado em ${((Date.now() - started) / 1000).toFixed(1)}s: ${added} novas${lag}, ${this.items.size} no acervo, ${failed} feeds com falha.`);
    this.onRefresh?.(this);
    return { added };
  }

  prune(now = Date.now()) {
    const min = now - MAX_AGE_HOURS * 3600e3;
    for (const [id, item] of this.items) if (Date.parse(item.published) < min) this.items.delete(id);
  }

  rebuild() {
    this.clusters = buildClusters(dedupe([...this.items.values()]));
    this.clusterByItem = new Map();
    for (const c of this.clusters) for (const i of c.items) this.clusterByItem.set(i.id, c);
  }

  getItem(id) {
    return this.items.get(id);
  }

  getCluster(id) {
    return this.clusterByItem.get(id) || null;
  }

  /**
   * @param {object} opts
   * @param {string} [opts.section] id da editoria; vazio para a capa
   * @param {boolean} [opts.confirmed] só histórias publicadas por 2+ veículos
   * @param {'relevance'|'recent'} [opts.order]
   */
  query({ section, confirmed = false, outlet, order = 'relevance', limit = 60, lang } = {}) {
    const now = Date.now();
    let list = this.clusters;
    if (section) list = list.filter((c) => c.section === section);
    if (confirmed) list = list.filter((c) => c.outletCount >= 2);
    if (outlet) list = list.filter((c) => c.items.some((i) => i.outletId === outlet));
    if (lang) list = list.filter((c) => c.lead.lang === lang);
    const sorted = [...list].sort(
      order === 'recent'
        ? (a, b) => Date.parse(b.latest) - Date.parse(a.latest)
        : (a, b) => score(b, now) - score(a, now),
    );
    return sorted.slice(0, limit);
  }

  latest(limit = 40) {
    return [...this.items.values()]
      .filter((i) => i.lang === 'pt')
      .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
      .slice(0, limit);
  }

  status() {
    const now = Date.now();
    return OUTLETS.map((outlet) => {
      const feeds = outlet.feeds.map((f) => {
        const s = this.feedStatus.get(f.url) || {};
        const stale = s.ok && s.newest && now - Date.parse(s.newest) > STALE_FEED_HOURS * 3600e3;
        return { url: f.url, section: f.section, ok: !!s.ok, stale: !!stale, error: s.error || null, fetchedAt: s.fetchedAt || null, itemCount: s.itemCount || 0, newest: s.newest || null };
      });
      return {
        id: outlet.id,
        name: outlet.name,
        site: outlet.site,
        readable: outlet.readable,
        lang: outlet.lang,
        ok: feeds.some((f) => f.ok),
        itemCount: [...this.items.values()].filter((i) => i.outletId === outlet.id).length,
        feeds,
      };
    });
  }
}
