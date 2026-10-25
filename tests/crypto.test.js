import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { deriveKey, newSalt, descriptor, keyMatches, sealJson, openJson } from '../src/crypto.js';

const ITER = 1000; // rápido nos testes; o robô usa 600 mil

test('cifra e decifra a edição com a mesma frase-senha', () => {
  const salt = newSalt();
  const key = deriveKey('quatro palavras bem longas', salt, ITER);
  const data = { manchete: 'Notícia com acentuação: ção, ã, é' };
  assert.deepEqual(openJson(sealJson(data, key), key), data);
});

test('senha errada não abre e é detectada pelo descritor', () => {
  const salt = newSalt();
  const key = deriveKey('senha certa', salt, ITER);
  const wrong = deriveKey('senha errada', salt, ITER);
  const desc = descriptor(salt, key, ITER);
  assert.equal(keyMatches(desc, key), true);
  assert.equal(keyMatches(desc, wrong), false);
  assert.throws(() => openJson(sealJson({ a: 1 }, key), wrong));
});

test('o navegador (Web Crypto) abre o que o robô cifrou', async () => {
  const salt = newSalt();
  const password = 'frase de teste do panorama';
  const sealed = sealJson({ ok: true, texto: 'Olá' }, deriveKey(password, salt, ITER));

  // Mesmo caminho de public/app.js: PBKDF2 -> AES-GCM -> gzip.
  const { subtle } = globalThis.crypto;
  const material = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const raw = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(salt, 'base64'), iterations: ITER }, material, 256);
  const key = await subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: sealed.subarray(0, 12) }, key, sealed.subarray(12));
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(plain)).toString()), { ok: true, texto: 'Olá' });
});

test('limpeza do texto remove restos de player e créditos do site', async () => {
  const { cleanBody } = await import('../src/texts.js');
  const html = '<p>play Maurício e Giay marcam (3:37)</p><p>ESPN.com.br</p><p>O Palmeiras venceu o Red Bull Bragantino por 2 a 0 neste sábado, na Arena Barueri, e assumiu a liderança.</p><p>Leia também: outra notícia</p>';
  const out = cleanBody(html);
  assert.ok(out.includes('O Palmeiras venceu'));
  assert.ok(!out.includes('play'));
  assert.ok(!out.includes('ESPN.com.br'));
  assert.ok(!out.includes('Leia também'));
});
