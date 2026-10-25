// Arquivo permanente do Panorama: tudo o que passou pela edição fica guardado por dia.
//   - matérias confirmadas (2+ veículos): título, resumo, imagem, texto completo e originais;
//   - notas rápidas (1 veículo): só o título, para a busca continuar achando.
//
// Um dia fica "aberto" enquanto suas notícias ainda podem mudar (ganhar veículos, texto):
// hoje e os 2 dias anteriores, que viajam no estado do robô. Depois disso o dia "fecha" e é
// gravado de uma vez em `closedDir` (no GitHub, a branch `arquivo` do repositório), com o
// índice do mês usado pela busca. Os arquivos são cifrados quando há chave.
//
//   <closedDir>/dias.json              lista de dias fechados e quantas notícias cada um tem
//   <closedDir>/dias/AAAA-MM-DD.json   edição completa do dia
//   <closedDir>/indice/AAAA-MM.json    linhas curtas para a busca do mês

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sealJson, openJson } from './crypto.js';
import { dayOf } from './newsroom.js';
import { toStory } from './present.js';

const OPEN_DAYS = 3; // hoje e os 2 anteriores

/** Leitura e escrita de JSON, cifrado quando há chave (<nome>.json.bin). */
export function jsonFiles(key) {
  return {
    async read(path) {
      const buf = await readFile(key ? `${path}.bin` : path);
      return key ? openJson(buf, key) : JSON.parse(buf.toString('utf8'));
    },
    async write(path, data) {
      await writeFile(key ? `${path}.bin` : path, key ? sealJson(data, key) : JSON.stringify(data));
    },
  };
}

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Linha curta de busca para uma notícia do arquivo. */
export function indexRow(e) {
  return { id: e.id, k: e.k, dia: e.day, t: e.title, d: e.k === 's' ? e.dek : '', s: e.section, a: e.assunto || null, u: e.updated, c: e.confirmations };
}

export class Archive {
  constructor({ log = console } = {}) {
    this.log = log;
    this.entries = new Map(); // key -> entrada de um dia ainda aberto
    this.byItem = new Map(); // itemId -> key
  }

  toJSON() {
    return [...this.entries.values()];
  }

  fromJSON(list) {
    this.entries.clear();
    this.byItem.clear();
    for (const e of list || []) this.#index(e);
  }

  #index(e) {
    this.entries.set(e.id, e);
    for (const id of e.itemIds) this.byItem.set(id, e.id);
  }

  /** Entrada que já representa este fato (a que compartilha mais reportagens com ele). */
  #entryFor(cluster) {
    const votes = new Map();
    for (const i of cluster.items) {
      const key = this.byItem.get(i.id);
      if (key) votes.set(key, (votes.get(key) || 0) + 1);
    }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? this.entries.get(best[0]) : null;
  }

  /**
   * Registra ou atualiza no arquivo tudo o que está na edição atual.
   * @param {Set<string>} closed dias já gravados, que não são reabertos
   */
  update(store, newsroom, texts, closed = new Set()) {
    for (const cluster of store.clusters) {
      if (cluster.lead.lang !== 'pt' && !newsroom.articleFor(cluster)?.apto) continue;
      const story = toStory(cluster, newsroom);
      const isStory = story.written || cluster.outletCount >= 2;
      let e = this.#entryFor(cluster);
      if (!e) {
        const day = dayOf(cluster.first);
        if (closed.has(day)) continue; // dia já gravado: não reabre
        e = { id: cluster.items[0].id, day, itemIds: [] };
      }
      Object.assign(e, {
        k: isStory ? 's' : 'n',
        section: story.section,
        assunto: story.assunto,
        title: story.title,
        published: story.published,
        updated: story.updated,
        confirmations: story.confirmations,
      });
      if (!isStory) e.link = cluster.lead.link;
      if (isStory) {
        delete e.link;
        e.dek = story.dek;
        e.image = story.image;
        e.originals = cluster.items.map((i) => ({ title: i.title, link: i.link, outlet: i.outletName, published: i.published }));
        const best = texts?.bestFor(cluster);
        if (best) e.corpo = best.html;
      }
      for (const i of cluster.items) if (!e.itemIds.includes(i.id)) e.itemIds.push(i.id);
      this.#index(e);
    }
  }

  /**
   * Fecha os dias que não podem mais mudar: grava cada um em `closedDir` e atualiza os
   * índices de busca dos meses. Devolve os dias fechados nesta chamada.
   */
  async close(closedDir, files, now = new Date()) {
    const firstOpenDay = addDays(dayOf(now.toISOString()), -(OPEN_DAYS - 1));
    const toClose = [...new Set([...this.entries.values()].map((e) => e.day))].filter((d) => d < firstOpenDay).sort();
    if (!toClose.length) return [];

    await mkdir(join(closedDir, 'dias'), { recursive: true });
    await mkdir(join(closedDir, 'indice'), { recursive: true });
    const days = await this.closedDays(closedDir, files);
    for (const day of toClose) {
      const list = [...this.entries.values()].filter((e) => e.day === day);
      await files.write(join(closedDir, 'dias', `${day}.json`), { day, entries: list.map(({ itemIds, ...e }) => e) });

      const month = day.slice(0, 7);
      const indexPath = join(closedDir, 'indice', `${month}.json`);
      const rows = (await files.read(indexPath).catch(() => [])).filter((r) => r.dia !== day);
      await files.write(indexPath, [...rows, ...list.map(indexRow)]);

      days[day] = { stories: list.filter((e) => e.k === 's').length, notes: list.filter((e) => e.k === 'n').length };
      for (const e of list) {
        this.entries.delete(e.id);
        for (const id of e.itemIds) if (this.byItem.get(id) === e.id) this.byItem.delete(id);
      }
    }
    await files.write(join(closedDir, 'dias.json'), days);
    this.log.info?.(`Arquivo: ${toClose.length} dia(s) fechado(s): ${toClose.join(', ')}.`);
    return toClose;
  }

  async closedDays(closedDir, files) {
    return files.read(join(closedDir, 'dias.json')).catch(() => ({}));
  }

  /**
   * Escreve o arquivo na edição (outDir/data/arquivo): copia os dias fechados e acrescenta
   * os dias abertos, mais a lista de dias e de meses que o app usa.
   */
  async publish(outArchiveDir, closedDir, files) {
    await mkdir(join(outArchiveDir, 'dias'), { recursive: true });
    await mkdir(join(outArchiveDir, 'indice'), { recursive: true });
    for (const sub of ['dias', 'indice']) {
      const names = await readdir(join(closedDir, sub)).catch(() => []);
      for (const name of names) await writeFile(join(outArchiveDir, sub, name), await readFile(join(closedDir, sub, name)));
    }
    const days = await this.closedDays(closedDir, files);
    for (const day of new Set([...this.entries.values()].map((e) => e.day))) {
      const list = [...this.entries.values()].filter((e) => e.day === day);
      await files.write(join(outArchiveDir, 'dias', `${day}.json`), { day, open: true, entries: list.map(({ itemIds, ...e }) => e) });
      days[day] = { stories: list.filter((e) => e.k === 's').length, notes: list.filter((e) => e.k === 'n').length, open: true };
    }
    const sorted = Object.entries(days).sort((a, b) => b[0].localeCompare(a[0])).map(([day, n]) => ({ day, ...n }));
    // Meses com índice de busca (só dias fechados: os abertos estão na busca das últimas 72 h).
    const months = [...new Set(sorted.filter((d) => !d.open).map((d) => d.day.slice(0, 7)))];
    await files.write(join(outArchiveDir, 'index.json'), { days: sorted, months });
  }
}
