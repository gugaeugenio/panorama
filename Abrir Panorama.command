#!/bin/zsh
# Abre o Panorama: liga o servidor (se ainda não estiver ligado) e abre o navegador.
# Dê dois cliques neste arquivo no Finder.

cd "$(dirname "$0")" || exit 1
URL="http://localhost:4321"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js não encontrado. Instale em https://nodejs.org e tente de novo."
  read -k1 "?Pressione uma tecla para fechar."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Primeira execução: instalando dependências..."
  npm install --omit=dev || { read -k1 "?Falha na instalação. Pressione uma tecla."; exit 1; }
fi

if ! curl -s -o /dev/null "$URL/api/meta"; then
  echo "Ligando o Panorama..."
  mkdir -p data
  nohup node server.js >> data/server.log 2>&1 &
  for _ in {1..30}; do
    curl -s -o /dev/null "$URL/api/meta" && break
    sleep 0.5
  done
fi

open "$URL"
echo "Panorama aberto em $URL. Pode fechar esta janela; o servidor continua rodando."
echo "Para desligar: pkill -f 'node server.js'"
