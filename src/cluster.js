// Agrupa matérias de veículos diferentes que tratam do mesmo fato.
//
// O agrupamento é conservador: é melhor deixar duas matérias do mesmo fato separadas do que
// juntar fatos diferentes e inflar a contagem de veículos que "confirmam" uma história.
// Duas matérias só são o mesmo fato quando, no mesmo idioma e numa janela de 36 h:
//   - compartilham termos significativos suficientes, com peso maior para termos raros no dia
//     (num dia de eleição, "Lula" e "turno" quase não distinguem uma matéria da outra);
//   - não trazem números conflitantes ("51%" e "56%" são pesquisas diferentes);
//   - não citam institutos de pesquisa ou estados diferentes;
// e a matéria nova precisa casar com a maioria do grupo, não com um único membro (evita que
// A~B e B~C arrastem A e C para a mesma história).

import { tokens, fold, isNumberToken } from './text.js';
import { SECTION_IDS } from './sources.js';

const WINDOW_MS = 36 * 3600e3;

const POLLSTERS = /\b(datafolha|quaest|atlas|atlasintel|futura|nexus|ipec|ipespe|paranaense|real time|genial|parana pesquisas|ideia|vox)\b/g;
const STATES = [
  ['ac', 'acre'], ['al', 'alagoas'], ['ap', 'amapa'], ['am', 'amazonas'], ['ba', 'bahia'], ['ce', 'ceara'],
  ['df', 'distrito federal|brasilia'], ['es', 'espirito santo'], ['go', 'goias'], ['ma', 'maranhao'],
  ['mt', 'mato grosso(?! do sul)'], ['ms', 'mato grosso do sul'], ['mg', 'minas gerais|minas'], ['pa', 'para(?! de)'],
  ['pb', 'paraiba'], ['pr', 'parana(?! pesquisas)'], ['pe', 'pernambuco|recife'], ['pi', 'piaui'],
  ['rj', 'rio de janeiro'], ['rn', 'rio grande do norte'], ['rs', 'rio grande do sul'], ['ro', 'rondonia'],
  ['rr', 'roraima'], ['sc', 'santa catarina'], ['sp', 'sao paulo'], ['se', 'sergipe'], ['to', 'tocantins'],
].map(([uf, names]) => [uf, new RegExp(`\\b(${names})\\b`)]);

/** Representação de um título usada na comparação. */
export function features(title) {
  const toks = tokens(title);
  const folded = fold(title);
  const nums = new Set([...toks].filter((t) => isNumberToken(t) && !/^20\d\d$/.test(t)));
  const pollsters = new Set([...folded.matchAll(POLLSTERS)].map((m) => (m[1] === 'atlasintel' ? 'atlas' : m[1])));
  const states = new Set();
  for (const [uf, re] of STATES) if (toks.has(uf) || re.test(folded)) states.add(uf);
  return { toks, nums, pollsters, states };
}

const disjoint = (a, b) => a.size > 0 && b.size > 0 && ![...a].some((x) => b.has(x));

/**
 * @param {ReturnType<typeof features>} a
 * @param {ReturnType<typeof features>} b
 * @param {(t: string) => number} [weight] peso de cada termo (IDF); 1 quando omitido
 */
export function similar(a, b, weight = () => 1) {
  if (disjoint(a.nums, b.nums) || disjoint(a.pollsters, b.pollsters) || disjoint(a.states, b.states)) return false;
  let shared = 0;
  let wShared = 0;
  let wUnion = 0;
  let wA = 0;
  let wB = 0;
  for (const t of a.toks) {
    const w = weight(t);
    wUnion += w;
    wA += w;
    if (b.toks.has(t)) {
      shared++;
      wShared += w;
    }
  }
  for (const t of b.toks) {
    const w = weight(t);
    wB += w;
    if (!a.toks.has(t)) wUnion += w;
  }
  if (shared < 3) return false;
  // Títulos de tamanhos muito diferentes: basta o menor estar quase todo contido no maior.
  return wShared / wUnion >= 0.3 || (shared >= 4 && wShared / Math.min(wA, wB) >= 0.55);
}

/** Remove duplicatas do mesmo veículo (mesmo link em vários feeds, ou título idêntico). */
export function dedupe(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = `${item.outletId}|${item.title.toLowerCase()}`;
    const prev = byKey.get(item.id) || byKey.get(key);
    if (prev) {
      // Mantém a editoria vinda de um feed temático, que é mais confiável que 'auto'.
      if (!prev.image && item.image) prev.image = item.image;
      if (!prev.summary && item.summary) prev.summary = item.summary;
      continue;
    }
    byKey.set(item.id, item);
    byKey.set(key, item);
  }
  return [...new Set(byKey.values())];
}

function majoritySection(items) {
  const counts = new Map();
  for (const i of items) counts.set(i.section, (counts.get(i.section) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || SECTION_IDS.indexOf(a[0]) - SECTION_IDS.indexOf(b[0]))[0][0];
}

/** Relevância para a capa: mais veículos e mais recente sobe. */
export function score(cluster, now = Date.now()) {
  const ageHours = Math.max(0, (now - Date.parse(cluster.latest)) / 3600e3);
  return Math.pow(cluster.outletCount, 1.25) / Math.pow(1 + ageHours / 6, 0.9);
}

export function buildClusters(items, now = Date.now()) {
  const sorted = [...items].sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
  const feats = new Map(sorted.map((i) => [i.id, features(i.title)]));
  const df = new Map();
  for (const f of feats.values()) for (const t of f.toks) df.set(t, (df.get(t) || 0) + 1);
  const n = Math.max(feats.size, 1);
  const weight = (t) => Math.log(1 + n / (df.get(t) || 1));
  const groups = []; // { members: [{item, toks}], outlets: Set }
  const index = new Map(); // token -> Set<groupIndex>

  for (const item of sorted) {
    const feat = feats.get(item.id);
    const toks = feat.toks;
    const time = Date.parse(item.published);
    const candidates = new Set();
    for (const t of toks) for (const g of index.get(t) || []) candidates.add(g);

    let target = -1;
    for (const g of candidates) {
      const group = groups[g];
      if (group.lang !== item.lang) continue;
      // Cada veículo aparece uma vez por grupo; a segunda matéria dele sobre o tema vira grupo próprio.
      if (group.outlets.has(item.outletId)) continue;
      const hits = group.members.filter((m) => Math.abs(m.time - time) <= WINDOW_MS && similar(m.feat, feat, weight)).length;
      if (hits > 0 && hits * 2 >= group.members.length) {
        target = g;
        break;
      }
    }

    if (target === -1) {
      target = groups.length;
      groups.push({ members: [], outlets: new Set(), lang: item.lang });
    }
    const group = groups[target];
    group.members.push({ item, feat, time });
    group.outlets.add(item.outletId);
    for (const t of toks) {
      if (!index.has(t)) index.set(t, new Set());
      index.get(t).add(target);
    }
  }

  return groups.map((g) => {
    const members = g.members.map((m) => m.item).sort((a, b) => Date.parse(a.published) - Date.parse(b.published));
    // Manchete principal: a versão mais completa (com resumo e imagem), preferindo a mais antiga,
    // que costuma ser a do veículo que deu a notícia primeiro.
    const lead = [...members].sort((a, b) => (b.summary ? 1 : 0) + (b.image ? 1 : 0) - ((a.summary ? 1 : 0) + (a.image ? 1 : 0)))[0];
    const cluster = {
      id: lead.id,
      lead,
      items: members,
      outletCount: g.outlets.size,
      section: majoritySection(members),
      first: members[0].published,
      latest: members[members.length - 1].published,
    };
    cluster.score = score(cluster, now);
    return cluster;
  });
}
