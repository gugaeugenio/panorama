// Criptografia da edição. O app é publicado num endereço público (GitHub Pages), então tudo
// em data/ sai cifrado: sem a frase-senha, os arquivos são ilegíveis.
//
// Esquema (o mesmo decifrado no navegador por public/app.js, com Web Crypto):
//   chave   = PBKDF2-SHA256(frase-senha, sal, ITERATIONS) -> 256 bits
//   arquivo = iv (12 bytes) || AES-256-GCM(gzip(json)) || tag (16 bytes)
// O sal e uma prova de chave correta ficam em data/cripto.json (não são segredos).

import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const ITERATIONS = 600000;
const CHECK_TEXT = 'panorama';

export function deriveKey(password, salt, iterations = ITERATIONS) {
  return pbkdf2Sync(password, Buffer.from(salt, 'base64'), iterations, 32, 'sha256');
}

export function newSalt() {
  return randomBytes(16).toString('base64');
}

export function seal(plain, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]);
}

export function open(sealed, key) {
  const iv = sealed.subarray(0, 12);
  const tag = sealed.subarray(sealed.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(12, sealed.length - 16)), decipher.final()]);
}

export const sealJson = (data, key) => seal(gzipSync(JSON.stringify(data)), key);
export const openJson = (sealed, key) => JSON.parse(gunzipSync(open(sealed, key)).toString('utf8'));

/** Descritor público (data/cripto.json): o app deriva a chave e confere a senha com ele. */
export function descriptor(salt, key, iterations = ITERATIONS) {
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt, check: seal(Buffer.from(CHECK_TEXT), key).toString('base64') };
}

export function keyMatches(desc, key) {
  try {
    return open(Buffer.from(desc.check, 'base64'), key).toString() === CHECK_TEXT;
  } catch {
    return false;
  }
}
