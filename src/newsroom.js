// Redação do Panorama: transforma cada fato confirmado por vários veículos em UMA matéria
// própria, escrita pelo Claude só com o que as reportagens trazem.
//
// Cada fato é escrito UMA vez e guardado para sempre no arquivo (data/arquivo/AAAA-MM.json).
// Nada é reescrito: quando novos veículos noticiam um fato já redigido, só a contagem de
// confirmações e a lista de reportagens são atualizadas, sem nova chamada à API.
//
// Garantias de apuração:
//   - o modelo recebe as reportagens sem o nome dos veículos e é proibido de acrescentar
//     qualquer dado que não esteja nelas;
//   - só fatos publicados por `minOutlets` ou mais veículos são escritos;
//   - quando as reportagens não sustentam uma matéria, o modelo responde apto=false e o fato
//     fica nas notas rápidas, com o título original.

import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SECTIONS, SECTION_IDS } from './sources.js';
import { extractArticle } from './reader.js';
import { mapLimit } from './fetcher.js';
import { hashId } from './text.js';

const SOURCE_TEXT_MAX = 5000;
const MAX_SOURCES = 6;
const MAX_FULL_TEXTS = 3;
const WINDOW_MS = 36 * 3600e3;

const SYSTEM_PROMPT = `Você é o redator do Panorama, um jornal pessoal em português do Brasil. Você recebe várias reportagens, de veículos de imprensa profissionais, sobre o mesmo fato, e escreve UMA matéria do Panorama.

Apuração (inegociável):
- Use somente informações que estejam nas reportagens fornecidas. Não acrescente contexto, números, datas, nomes, cargos ou explicações que não estejam nelas, mesmo que você os conheça.
- Se as reportagens divergirem num dado, informe a divergência de forma neutra ou deixe o dado de fora. Nunca escolha um lado sem base.
- Não mencione jornais, sites, portais, emissoras, rádios, revistas ou agências de notícias, nem expressões como "segundo o jornal" ou "em entrevista ao portal". Atribua declarações a quem falou ("disse o ministro").
- Mantenha nomes de pessoas, órgãos públicos, empresas, entidades e institutos de pesquisa (como Datafolha, Quaest, IBGE, TSE): eles fazem parte do fato.
- Tom neutro e informativo. Sem adjetivos de opinião, sem especulação, sem sensacionalismo, sem chamar o leitor ("confira", "veja").
- Use as datas como as reportagens trazem ("neste sábado (24)").

Formato:
- titulo: manchete objetiva, até 100 caracteres.
- linha_fina: uma frase que completa a manchete.
- em_resumo: de 2 a 4 frases curtas com os fatos essenciais.
- texto: de 2 a 6 parágrafos curtos, do mais importante ao menos importante.
- assunto: o tema maior em 1 a 4 palavras (ex.: "Eleições 2026", "Brasileirão", "Guerra na Ucrânia"). Reaproveite exatamente um dos assuntos existentes quando o fato pertencer a ele.
- editoria: a id da editoria que melhor descreve o fato.
- apto: false se as reportagens não sustentam uma matéria (só títulos sem conteúdo, fatos diferentes misturados, conteúdo promocional). Nesse caso, os demais campos podem ficar vazios.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['apto', 'titulo', 'linha_fina', 'em_resumo', 'texto', 'assunto', 'editoria'],
  properties: {
    apto: { type: 'boolean' },
    titulo: { type: 'string' },
    linha_fina: { type: 'string' },
    em_resumo: { type: 'array', items: { type: 'string' } },
    texto: { type: 'array', items: { type: 'string' } },
    assunto: { type: 'string' },
    editoria: { type: 'string', enum: SECTION_IDS },
  },
};

// Modelos que aceitam o fallback automático no servidor quando um pedido é recusado.
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export class Newsroom {
  constructor({ dir, model, effort = 'medium', minOutlets = 2, perCycle = 15, dailyLimit = 120, concurrency = 2, log = console, client } = {}) {
    this.dir = dir;
    this.model = model;
    this.effort = effort;
    this.minOutlets = minOutlets;
    this.perCycle = perCycle;
    this.dailyLimit = dailyLimit;
    this.concurrency = concurrency;
    this.log = log;
    this.client = client ?? (process.env.ANTHROPIC_API_KEY ? new Anthropic() : null);
    this.articles = new Map(); // key -> article
    this.byItem = new Map(); // itemId -> key
    this.dirtyMonths = new Set();
    this.usage = { day: '', count: 0 };
    this.running = null;
    this.lastError = null;
    this.version = 0;
  }

  get enabled() {
    return !!this.client;
  }

  status() {
    return {
      enabled: this.enabled,
      model: this.enabled ? this.model : null,
      written: [...this.articles.values()].filter((a) => a.apto).length,
      today: this.usage.day === today() ? this.usage.count : 0,
      dailyLimit: this.dailyLimit,
      running: !!this.running,
      lastError: this.lastError,
    };
  }

  async load() {
    if (!this.dir) return;
    try {
      const state = JSON.parse(await readFile(join(this.dir, 'redacao.json'), 'utf8'));
      this.usage = state.usage || this.usage;
    } catch (error) {
      if (error.code !== 'ENOENT') this.log.warn?.(`Estado da redação ignorado (${error.message}).`);
    }
    let files = [];
    try {
      files = (await readdir(join(this.dir, 'arquivo'))).filter((f) => /^\d{4}-\d{2}\.json$/.test(f));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const f of files) {
      try {
        for (const a of JSON.parse(await readFile(join(this.dir, 'arquivo', f), 'utf8'))) this.#index(a);
      } catch (error) {
        this.log.warn?.(`Arquivo ${f} ignorado (${error.message}).`);
      }
    }
  }

  /** Grava só os meses que mudaram; o arquivo de meses passados não é reescrito. */
  async save() {
    if (!this.dir) return;
    await mkdir(join(this.dir, 'arquivo'), { recursive: true });
    for (const m of this.dirtyMonths) {
      const list = [...this.articles.values()].filter((a) => monthOf(a) === m);
      await atomicWrite(join(this.dir, 'arquivo', `${m}.json`), JSON.stringify(list));
    }
    this.dirtyMonths.clear();
    await atomicWrite(join(this.dir, 'redacao.json'), JSON.stringify({ usage: this.usage }));
    this.version++;
  }

  #index(article) {
    this.articles.set(article.key, article);
    for (const id of article.itemIds) this.byItem.set(id, article.key);
  }

  /** Matéria já escrita para um cluster (a que compartilha mais itens com ele). */
  articleFor(cluster) {
    const votes = new Map();
    for (const i of cluster.items) {
      const key = this.byItem.get(i.id);
      if (key) votes.set(key, (votes.get(key) || 0) + 1);
    }
    let best = null;
    let bestVotes = 0;
    for (const [key, n] of votes) {
      if (n > bestVotes) {
        best = key;
        bestVotes = n;
      }
    }
    return best ? this.articles.get(best) : null;
  }

  assuntos() {
    const count = new Map();
    for (const a of this.articles.values()) if (a.apto && a.assunto) count.set(a.assunto, (count.get(a.assunto) || 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([name]) => name);
  }

  needsWriting(cluster, now = Date.now()) {
    if (cluster.outletCount < this.minOutlets) return false;
    if (now - Date.parse(cluster.latest) > WINDOW_MS) return false;
    return !this.articleFor(cluster);
  }

  /**
   * Mantém as matérias já escritas em dia com o acervo, sem chamar a API: novos veículos
   * que noticiaram o fato entram na contagem e na lista de reportagens originais.
   */
  attach(store) {
    let changed = 0;
    for (const cluster of store.clusters) {
      const a = this.articleFor(cluster);
      if (!a) continue;
      const fresh = cluster.items.filter((i) => !a.itemIds.includes(i.id));
      const moreOutlets = cluster.outletCount > a.outletCount;
      if (!fresh.length && !moreOutlets) continue;
      for (const i of fresh) {
        a.itemIds.push(i.id);
        this.byItem.set(i.id, a.key);
        a.originals?.push(original(i));
      }
      a.outletCount = Math.max(a.outletCount, cluster.outletCount);
      if (cluster.latest > (a.updated || '')) a.updated = cluster.latest;
      if (!a.image) a.image = cluster.items.find((i) => i.image)?.image || null;
      this.dirtyMonths.add(monthOf(a));
      changed++;
    }
    return changed;
  }

  /** Escreve as matérias pendentes, das mais relevantes para as menos. */
  run(store) {
    if (!this.enabled || this.running) return this.running;
    this.running = this.#run(store).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async #run(store) {
    if (this.attach(store)) await this.save();
    if (this.usage.day !== today()) this.usage = { day: today(), count: 0 };
    const budget = Math.min(this.perCycle, this.dailyLimit - this.usage.count);
    if (budget <= 0) return;

    const pending = store.query({ limit: Infinity }).filter((c) => this.needsWriting(c)).slice(0, budget);
    if (!pending.length) return;
    this.log.info?.(`Redação: escrevendo ${pending.length} matérias com ${this.model}.`);

    let written = 0;
    await mapLimit(pending, this.concurrency, async (cluster) => {
      try {
        const article = await this.write(cluster);
        this.#index(article);
        this.dirtyMonths.add(monthOf(article));
        this.usage.count++;
        if (article.apto) written++;
        this.lastError = null;
      } catch (error) {
        this.lastError = describeError(error);
        this.log.warn?.(`Redação: falha ao escrever "${cluster.lead.title.slice(0, 60)}": ${this.lastError}`);
      }
    });
    await this.save();
    this.log.info?.(`Redação: ${written} matérias novas.`);
  }

  async write(cluster) {
    const sources = await gatherSources(cluster);
    const prompt = buildPrompt(sources, this.assuntos());

    const fallback = FALLBACK_MODELS.has(this.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      ...fallback,
      system: SYSTEM_PROMPT,
      output_config: { effort: this.effort, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    });

    if (response.stop_reason === 'refusal') throw new Error(`recusado (${response.stop_details?.category || 'sem categoria'})`);
    if (response.stop_reason === 'max_tokens') throw new Error('resposta cortada (max_tokens)');
    const text = response.content.find((b) => b.type === 'text')?.text;
    if (!text) throw new Error('resposta sem texto');
    const out = JSON.parse(text);

    const itemIds = cluster.items.map((i) => i.id);
    return {
      key: cluster.id,
      itemIds,
      outletCount: cluster.outletCount,
      sourceCount: sources.length,
      writtenAt: new Date().toISOString(),
      model: response.model,
      apto: !!out.apto && !!out.titulo && out.texto?.length > 0,
      titulo: clean(out.titulo),
      linhaFina: clean(out.linha_fina),
      emResumo: (out.em_resumo || []).map(clean).filter(Boolean),
      texto: (out.texto || []).map(clean).filter(Boolean),
      assunto: clean(out.assunto),
      editoria: SECTION_IDS.includes(out.editoria) ? out.editoria : cluster.section,
      // Retrato do fato, para a matéria continuar legível depois que as reportagens saírem do acervo.
      published: cluster.first,
      updated: cluster.latest,
      image: cluster.items.find((i) => i.image)?.image || null,
      originals: cluster.items.map(original),
    };
  }
}

const original = (i) => ({ title: i.title, link: i.link, outlet: i.outletName, published: i.published });

/** Mês (horário de Brasília) em que o fato foi publicado: define o arquivo onde a matéria mora. */
export function monthOf(article) {
  return dayOf(article.published || article.writtenAt).slice(0, 7);
}

export function dayOf(iso) {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

async function atomicWrite(path, body) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, path);
}

function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

function clean(s = '') {
  return String(s).replace(/\s+/g, ' ').trim();
}

function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) return 'chave da API inválida';
  if (error instanceof Anthropic.PermissionDeniedError) return 'chave sem permissão para este modelo';
  if (error instanceof Anthropic.RateLimitError) return 'limite de uso da API atingido; tenta de novo no próximo ciclo';
  if (error instanceof Anthropic.APIError) return `API respondeu ${error.status}: ${error.message}`;
  return error.message;
}

/** Reúne até MAX_SOURCES reportagens, com texto integral das de acesso aberto. */
async function gatherSources(cluster) {
  const items = [...cluster.items].sort((a, b) => Number(b.readable) - Number(a.readable)).slice(0, MAX_SOURCES);
  let fullTexts = 0;
  return mapLimit(items, 3, async (item) => {
    let body = '';
    if (item.readable && fullTexts < MAX_FULL_TEXTS) {
      fullTexts++;
      const a = await extractArticle(item).catch(() => null);
      if (a?.ok && a.text) body = a.text.slice(0, SOURCE_TEXT_MAX);
    }
    return { title: item.title, summary: item.summary, body, published: item.published };
  });
}

function buildPrompt(sources, assuntos) {
  const parts = [
    `Agora é ${dateFmt.format(new Date())} (horário de Brasília).`,
    `Editorias: ${SECTIONS.map((s) => `${s.id} (${s.name})`).join(', ')}.`,
    `Assuntos existentes: ${assuntos.length ? assuntos.join('; ') : 'nenhum ainda'}.`,
    '',
  ];
  sources.forEach((s, i) => {
    parts.push(`<reportagem numero="${i + 1}" publicada="${dateFmt.format(new Date(s.published))}">`);
    parts.push(`Título: ${s.title}`);
    if (s.summary) parts.push(`Resumo: ${s.summary}`);
    if (s.body) parts.push(`Texto: ${s.body}`);
    parts.push('</reportagem>', '');
  });
  parts.push('Escreva a matéria do Panorama sobre o fato que essas reportagens descrevem.');
  return parts.join('\n');
}
