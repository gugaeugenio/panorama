// Catálogo de veículos e feeds. Todos validados manualmente em outubro de 2026.
//
// Campos do veículo:
//   readable  modo leitura permitido (site de acesso aberto). Veículos com paywall ficam
//             false: mostramos só o título e o resumo que o próprio feed publica.
//   lang      'pt' ou 'en'. O agrupamento entre veículos só compara títulos do mesmo idioma.
// Campos do feed:
//   section   editoria fixa, ou 'auto' para classificar pela URL e pelas categorias do item.
//   fallback  editoria usada quando um feed 'auto' não dá pistas.

export const SECTIONS = [
  { id: 'politica', name: 'Política' },
  { id: 'economia', name: 'Economia' },
  { id: 'mundo', name: 'Mundo' },
  { id: 'esporte', name: 'Esporte' },
  { id: 'brasil', name: 'Brasil' },
  { id: 'ciencia', name: 'Ciência e tecnologia' },
];

export const SECTION_IDS = SECTIONS.map((s) => s.id);

export const OUTLETS = [
  {
    id: 'g1', name: 'g1', site: 'https://g1.globo.com', readable: true, lang: 'pt',
    feeds: [
      { url: 'https://g1.globo.com/rss/g1/', section: 'auto', fallback: 'brasil' },
      { url: 'https://g1.globo.com/rss/g1/politica/', section: 'politica' },
      { url: 'https://g1.globo.com/rss/g1/economia/', section: 'economia' },
      { url: 'https://g1.globo.com/rss/g1/mundo/', section: 'mundo' },
    ],
  },
  {
    id: 'ge', name: 'ge', site: 'https://ge.globo.com', readable: true, lang: 'pt',
    feeds: [
      { url: 'https://ge.globo.com/rss/ge/', section: 'esporte' },
      { url: 'https://ge.globo.com/rss/ge/futebol/', section: 'esporte' },
    ],
  },
  {
    id: 'folha', name: 'Folha de S.Paulo', site: 'https://www.folha.uol.com.br', readable: false, lang: 'pt',
    feeds: [
      { url: 'https://feeds.folha.uol.com.br/emcimadahora/rss091.xml', section: 'auto', fallback: 'brasil' },
      { url: 'https://feeds.folha.uol.com.br/poder/rss091.xml', section: 'politica' },
      { url: 'https://feeds.folha.uol.com.br/mercado/rss091.xml', section: 'economia' },
      { url: 'https://feeds.folha.uol.com.br/mundo/rss091.xml', section: 'mundo' },
      { url: 'https://feeds.folha.uol.com.br/esporte/rss091.xml', section: 'esporte' },
    ],
  },
  {
    id: 'estadao', name: 'Estadão', site: 'https://www.estadao.com.br', readable: false, lang: 'pt',
    feeds: [
      { url: 'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/politica/', section: 'politica' },
      { url: 'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/economia/', section: 'economia' },
      { url: 'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/internacional/', section: 'mundo' },
      { url: 'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/esportes/', section: 'esporte' },
      { url: 'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/brasil/', section: 'brasil' },
    ],
  },
  {
    id: 'oglobo', name: 'O Globo', site: 'https://oglobo.globo.com', readable: false, lang: 'pt',
    feeds: [{ url: 'https://oglobo.globo.com/rss/oglobo', section: 'auto', fallback: 'brasil' }],
  },
  {
    id: 'agenciabrasil', name: 'Agência Brasil', site: 'https://agenciabrasil.ebc.com.br', readable: true, lang: 'pt',
    feeds: [
      { url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml', section: 'auto', fallback: 'brasil' },
      { url: 'https://agenciabrasil.ebc.com.br/rss/politica/feed.xml', section: 'politica' },
      { url: 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml', section: 'economia' },
      { url: 'https://agenciabrasil.ebc.com.br/rss/internacional/feed.xml', section: 'mundo' },
      { url: 'https://agenciabrasil.ebc.com.br/rss/esportes/feed.xml', section: 'esporte' },
      { url: 'https://agenciabrasil.ebc.com.br/rss/saude/feed.xml', section: 'ciencia' },
    ],
  },
  {
    id: 'cnn', name: 'CNN Brasil', site: 'https://www.cnnbrasil.com.br', readable: true, lang: 'pt',
    feeds: [{ url: 'https://www.cnnbrasil.com.br/feed/', section: 'auto', fallback: 'brasil' }],
  },
  {
    id: 'poder360', name: 'Poder360', site: 'https://www.poder360.com.br', readable: true, lang: 'pt',
    feeds: [{ url: 'https://www.poder360.com.br/feed/', section: 'auto', fallback: 'politica' }],
  },
  {
    id: 'valor', name: 'Valor Econômico', site: 'https://valor.globo.com', readable: false, lang: 'pt',
    feeds: [{ url: 'https://valor.globo.com/rss/valor', section: 'auto', fallback: 'economia' }],
  },
  {
    id: 'infomoney', name: 'InfoMoney', site: 'https://www.infomoney.com.br', readable: true, lang: 'pt',
    feeds: [{ url: 'https://www.infomoney.com.br/feed/', section: 'economia' }],
  },
  {
    id: 'exame', name: 'Exame', site: 'https://exame.com', readable: true, lang: 'pt',
    feeds: [{ url: 'https://exame.com/feed/', section: 'auto', fallback: 'economia' }],
  },
  {
    id: 'metropoles', name: 'Metrópoles', site: 'https://www.metropoles.com', readable: true, lang: 'pt',
    feeds: [{ url: 'https://www.metropoles.com/feed', section: 'auto', fallback: 'brasil' }],
  },
  {
    id: 'jovempan', name: 'Jovem Pan', site: 'https://jovempan.com.br', readable: true, lang: 'pt',
    feeds: [{ url: 'https://jovempan.com.br/feed', section: 'auto', fallback: 'brasil' }],
  },
  {
    id: 'cartacapital', name: 'CartaCapital', site: 'https://www.cartacapital.com.br', readable: true, lang: 'pt',
    feeds: [{ url: 'https://www.cartacapital.com.br/feed/', section: 'auto', fallback: 'politica' }],
  },
  {
    id: 'uol', name: 'UOL', site: 'https://www.uol.com.br', readable: true, lang: 'pt',
    feeds: [{ url: 'https://rss.uol.com.br/feed/noticias.xml', section: 'auto', fallback: 'brasil' }],
  },
  {
    id: 'bbcbrasil', name: 'BBC News Brasil', site: 'https://www.bbc.com/portuguese', readable: true, lang: 'pt',
    feeds: [{ url: 'https://feeds.bbci.co.uk/portuguese/rss.xml', section: 'auto', fallback: 'mundo' }],
  },
  {
    id: 'dw', name: 'DW Brasil', site: 'https://www.dw.com/pt-br', readable: true, lang: 'pt',
    feeds: [{ url: 'https://rss.dw.com/rdf/rss-br-all', section: 'auto', fallback: 'mundo' }],
  },
  {
    id: 'rfi', name: 'RFI Brasil', site: 'https://www.rfi.fr/br', readable: true, lang: 'pt',
    feeds: [{ url: 'https://www.rfi.fr/br/rss', section: 'auto', fallback: 'mundo' }],
  },
  {
    id: 'espn', name: 'ESPN Brasil', site: 'https://www.espn.com.br', readable: true, lang: 'pt',
    feeds: [{ url: 'https://www.espn.com.br/rss/futebol', section: 'esporte' }],
  },
  {
    id: 'gazetaesportiva', name: 'Gazeta Esportiva', site: 'https://www.gazetaesportiva.com', readable: true, lang: 'pt',
    feeds: [{ url: 'https://www.gazetaesportiva.com/feed/', section: 'esporte' }],
  },
  {
    id: 'canaltech', name: 'Canaltech', site: 'https://canaltech.com.br', readable: true, lang: 'pt',
    feeds: [{ url: 'https://canaltech.com.br/rss/', section: 'ciencia' }],
  },
  {
    id: 'bcb', name: 'Banco Central', site: 'https://www.bcb.gov.br', readable: true, lang: 'pt',
    feeds: [{ url: 'https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/notasImprensa', section: 'economia' }],
  },
  {
    id: 'guardian', name: 'The Guardian', site: 'https://www.theguardian.com', readable: true, lang: 'en',
    feeds: [
      { url: 'https://www.theguardian.com/world/rss', section: 'mundo' },
      { url: 'https://www.theguardian.com/football/rss', section: 'esporte' },
    ],
  },
  {
    id: 'bbcworld', name: 'BBC News', site: 'https://www.bbc.com/news', readable: true, lang: 'en',
    feeds: [
      { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', section: 'mundo' },
      { url: 'https://feeds.bbci.co.uk/sport/football/rss.xml', section: 'esporte' },
    ],
  },
  {
    id: 'aljazeera', name: 'Al Jazeera', site: 'https://www.aljazeera.com', readable: true, lang: 'en',
    feeds: [{ url: 'https://www.aljazeera.com/xml/rss/all.xml', section: 'mundo' }],
  },
];

export const OUTLET_BY_ID = new Map(OUTLETS.map((o) => [o.id, o]));
