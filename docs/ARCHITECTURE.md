# Panorama — Arquitetura

Jornal pessoal que roda na sua máquina (`http://localhost:4321`). Reúne, por editoria, as
manchetes publicadas pelos próprios veículos de imprensa e mostra quantas redações
independentes confirmam cada fato.

## Princípio central: só o que as fontes publicaram

O Panorama apura em veículos profissionais e publica com a própria voz. As camadas de veracidade:

| Camada | Como funciona |
|---|---|
| Curadoria de fontes | Só veículos profissionais com redação identificável (`src/sources.js`), de linhas editoriais variadas. |
| Confirmação cruzada | Matérias sobre o mesmo fato em veículos diferentes são agrupadas (`src/cluster.js`). Só grupos com 2+ veículos viram matéria. |
| Redação ancorada | `src/newsroom.js` envia ao Claude as reportagens (sem nomes de veículos) e um schema JSON; o prompt proíbe acrescentar qualquer dado ausente das fontes. Sem sustentação, o modelo devolve `apto=false` e o fato fica nas notas rápidas. |
| Frescor | Itens com mais de 72 h saem do acervo; feeds parados aparecem em Bastidores. |

Sem `ANTHROPIC_API_KEY`, a redação fica desligada e as matérias mostram título e resumo originais.

## Fluxo

```
 feeds RSS oficiais ──► fetcher (timeout, charset, ETag) ──► parser (rss-parser)
                                                               │
                         classify (editoria por feed/URL/tags) ◄┘
                                     │
                         normalize (limpa HTML, datas, imagens)
                                     │
                         cluster (agrupa o mesmo fato entre veículos)
                                     │
                    store (memória + data/cache.json)  ◄── refresh a cada 10 min
                                     │
           server.js  /api/news  /api/search  /api/article  /api/indicators  /api/status
                                     │
                         newsroom (Claude escreve as matérias de grupos com 2+ veículos)
                                     │
                         present (manchete, assuntos, editorias, notas rápidas)
                                     │
                         public/ (interface do jornal)
```

## Módulos

| Arquivo | Responsabilidade |
|---|---|
| `src/sources.js` | Catálogo de veículos e feeds; editoria fixa ou `auto`; se o modo leitura é permitido |
| `src/fetcher.js` | HTTP com timeout, User-Agent, decodificação de charset (Folha usa ISO-8859-1), cache condicional |
| `src/feeds.js` | Parse do XML e normalização para o formato interno `Item` |
| `src/classify.js` | Define a editoria de itens vindos de feeds gerais (URL e categorias) |
| `src/cluster.js` | Similaridade de títulos (tokens normalizados, Jaccard) para agrupar o mesmo fato |
| `src/store.js` | Agendador de atualização, persistência, consultas por editoria |
| `src/indicators.js` | Dólar e euro PTAX, Selic meta, IPCA 12 meses — API SGS do BCB |
| `src/reader.js` | Modo leitura com Mozilla Readability, só para fontes abertas |
| `src/search.js` | Busca no acervo local + Google Notícias (marcado como tal) |
| `src/newsroom.js` | Redação: escreve, guarda (`data/articles.json`) e atualiza as matérias; teto diário de custo |
| `src/present.js` | Organiza o jornal: manchete, assuntos do dia, editorias, notas rápidas e detalhe da matéria |

## Editorias

Política · Economia · Mundo · Esporte · Brasil · Ciência e tecnologia. A capa ("Agora")
ordena as histórias por número de veículos que as confirmam e pela recência.

## Decisões

- **Node puro + 3 dependências** (`rss-parser`, `@mozilla/readability`, `jsdom`): roda com
  `npm start`, sem banco de dados nem build de frontend.
- **Sem paywall bypass.** Veículos pagos aparecem com título e resumo do próprio feed e link.
- **Google Notícias só na busca**, rotulado, porque agrega veículos fora da curadoria.
