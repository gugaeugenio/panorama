// Define a editoria de itens vindos de feeds gerais. A ordem de confiança é:
// 1) caminho da URL (decisão editorial do próprio veículo), 2) categorias do feed,
// 3) palavras do título, só para tirar da vala comum "brasil", 4) editoria padrão do feed.

import { fold } from './text.js';

const PATH_RULES = [
  ['politica', /^(politica|poder|eleicoes?|eleicoes-\d+|poder-eleicoes-\d+|congresso|governo|justica|stf)$/],
  ['economia', /^(economia|mercado|mercados|negocios|financas|financas-pessoais|investimentos|agronegocio|agro|empresas|carreira|business|money|dinheiro|impostos|minhas-financas|seu-dinheiro|macroeconomia)$/],
  ['mundo', /^(mundo|internacional|world|europa|americas|asia|africa|oriente-medio|franca|estados-unidos|eua|argentina|china)$/],
  ['esporte', /^(esporte|esportes|futebol|sport|brasileirao|libertadores|formula-1|f1|tenis|volei|basquete|nba|copa-do-mundo)$/],
  ['ciencia', /^(ciencia|ciencia-e-saude|saude|tecnologia|tecnologias|tec|tech|inovacao|meio-ambiente|ambiente|clima|espaco|educacao)$/],
  ['brasil', /^(brasil|cotidiano|sao-paulo|rio|rio-de-janeiro|distrito-federal|seguranca|policia|cidades|transito)$/],
];

const CATEGORY_RULES = [
  ['politica', /\b(politica|eleic|poder|congresso|governo|stf|justica)/],
  ['economia', /\b(economia|mercado|negocios|financas|investimento|agro|empresas)/],
  ['mundo', /\b(mundo|internacional|europa|americas|franca|estados unidos|oriente medio|asia|africa)/],
  ['esporte', /\b(esporte|futebol|brasileirao|libertadores|campeonato|formula 1|tenis|volei)/],
  ['ciencia', /\b(ciencia|saude|tecnologia|inovacao|meio ambiente|clima|educacao)/],
];

const TITLE_RULES = [
  ['politica', /\b(eleic|eleitor|turno|urna|tse|stf|congresso|camara|senado|deputad|senador|ministr|governador|prefeit|candidat|planalto|lula|bolsonaro|partido|pesquisa (quaest|datafolha|atlas|futura|ipec))/],
  ['economia', /\b(dolar|ibovespa|bolsa|selic|copom|inflacao|ipca|pib|juros|banco central|petrobras|tesouro|imposto|reforma tributaria|desemprego)/],
  ['esporte', /\b(futebol|brasileirao|libertadores|gol|palmeiras|flamengo|corinthians|vasco|santos|gremio|cruzeiro|atletico|botafogo|fluminense|selecao|copa do mundo|formula 1|rebeca andrade)/],
];

function fromPath(link) {
  let segments;
  try {
    segments = new URL(link).pathname.split('/').filter(Boolean).slice(0, 4).map((s) => fold(decodeURIComponent(s)).replace(/ /g, '-'));
  } catch {
    return null;
  }
  // Prioriza o primeiro segmento; ignora prefixos de idioma e de estado ("pt-br", "br", "rj").
  for (const seg of segments) {
    for (const [section, re] of PATH_RULES) if (re.test(seg)) return section;
  }
  return null;
}

function fromCategories(categories) {
  for (const raw of categories) {
    const c = fold(raw);
    for (const [section, re] of CATEGORY_RULES) if (re.test(c)) return section;
  }
  return null;
}

export function classifyTitle(title) {
  const t = fold(title);
  for (const [section, re] of TITLE_RULES) if (re.test(t)) return section;
  return null;
}

// Resultados de loteria saem em feeds de economia, mas não são notícia econômica.
const LOTTERY = /\b(mega sena|megasena|lotofacil|quina|lotomania|timemania|dupla sena|dia de sorte|super sete|milionaria|loteria|loterias|federal concurso)\b/;

/** Ajustes que valem até para feeds de editoria fixa. */
export function override(title, section) {
  return LOTTERY.test(fold(title)) ? 'brasil' : section;
}

export function classify({ link, categories = [], title = '', fallback = 'brasil' }) {
  const section = fromPath(link) || fromCategories(categories);
  if (section && section !== 'brasil') return section;
  return classifyTitle(title) || section || fallback;
}
