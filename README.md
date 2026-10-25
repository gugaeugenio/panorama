# Panorama

Seu jornal pessoal. Lê 25 veículos profissionais e, quando dois ou mais noticiam o mesmo
fato, escreve uma matéria própria do Panorama, organizada por editoria e por assunto.

## App no iPhone

O Panorama é publicado pelo robô do GitHub (`.github/workflows/edicao.yml`) a cada ~15
minutos, sem depender do Mac ligado. Para instalar no iPhone:

1. Abra o endereço do app no **Safari** (ex.: `https://gugaeugenio.github.io/panorama/`).
2. Toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.

O ícone abre o Panorama em tela cheia e, sem internet, mostra a última edição aberta.
O andamento do robô fica na aba **Actions** do repositório.

## Como abrir no Mac

Dois cliques em **`Abrir Panorama.command`** no Finder. Na primeira vez ele instala as
dependências; depois liga o servidor e abre `http://localhost:4321` no navegador.

Pelo terminal:

```bash
npm start
```

Para desligar:

```bash
pkill -f 'node server.js'
```

## Ligar a redação (a IA que escreve as matérias)

1. Crie uma chave em https://console.anthropic.com/settings/keys (a API é paga por uso).
2. Na pasta do Panorama, copie `.env.example` para `.env` e cole a chave em `ANTHROPIC_API_KEY`.
3. Escolha o modelo em `PANORAMA_MODELO` (o `.env.example` traz o custo de cada um) e o
   teto diário em `PANORAMA_LIMITE_DIARIO`.
4. Reabra pelo atalho. Em alguns minutos as matérias começam a aparecer; o andamento fica
   em **Bastidores** (link no rodapé).

Sem a chave, o Panorama funciona do mesmo jeito, mas mostra o título e o resumo originais.

## Como o jornal se organiza

- **Capa:** a manchete, os **Assuntos do dia** (cada tema, como "Eleições 2026", reúne a
  matéria principal e as relacionadas), um bloco por editoria e as **Notas rápidas**.
- **Editorias:** Política, Economia, Mundo, Esporte, Brasil, Ciência e tecnologia; dentro
  de cada uma, as matérias agrupadas por assunto.
- **Matéria:** título, linha fina, "Em resumo", texto, "Mais sobre o assunto" e, recolhida
  no fim, a lista das reportagens originais para conferência.
- **Notas rápidas:** fatos que só uma redação noticiou até agora, com o título original.
- **Arquivo:** toda matéria escrita fica guardada para sempre, organizada por dia
  (`data/arquivo/AAAA-MM.json`). Cada fato é escrito uma vez só; se mais jornais o
  noticiarem depois, só a contagem de confirmações é atualizada, sem novo custo.
- **Busca:** nas matérias do Panorama (inclusive do arquivo) e, à parte, na internet.
- **Indicadores:** dólar, euro, Selic e IPCA, direto do Banco Central.

## Como garante que é verdade

- Só fatos noticiados por **duas ou mais redações** viram matéria.
- A IA recebe as reportagens **sem o nome dos veículos** e tem ordem de usar só o que elas
  trazem: nada de dados, números ou contexto de fora. Divergências entre as fontes são
  informadas ou deixadas de fora.
- Nomes de institutos de pesquisa, órgãos e pessoas ficam no texto, porque fazem parte do fato.
- Cada matéria mostra quantos veículos confirmaram e guarda os links originais.

## Personalizar

- Fontes: `src/sources.js` (adicione um veículo com o URL do feed RSS e a editoria).
- Texto da redação: instruções em `src/newsroom.js` (`SYSTEM_PROMPT`).
- Intervalo de atualização: `PANORAMA_ATUALIZACAO_MIN` no `.env` (padrão: 2 min).
- Porta: variável `PORT` (padrão: 4321).

## Desenvolvimento

```bash
npm test
```
