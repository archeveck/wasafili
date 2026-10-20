#!/usr/bin/env node
/**
 * Test d'acceptation de la Phase 5 (P5.5) : la validation d'une fiche envoie automatiquement
 * le rapport PDF par e-mail. Joue le scénario par l'API publique sur l'instance de démo
 * (`pnpm db:seed`), puis vérifie l'e-mail et sa pièce jointe dans Mailpit.
 *
 *   node infra/acceptance/rapport-par-email.mjs
 *
 * Prérequis : infra (`pnpm infra:up`), API et worker démarrés (`pnpm dev` ou stack `full`).
 * Variables : API_URL (http://localhost:3000), MAILPIT_URL (http://localhost:8025),
 * API_HOST (en-tête Host, ex. `api.localhost` derrière Traefik).
 */
const API = process.env.API_URL ?? 'http://localhost:3000';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const HOST = process.env.API_HOST;
const PASSWORD = 'Wasafili2026!';
// PNG 1×1 : signature et photo de la fiche.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const step = (text) => console.log(`• ${text}`);

async function call(token, method, path, body) {
  const response = await fetch(`${API}/v1${path}`, {
    method,
    headers: {
      ...(HOST ? { host: HOST } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}

async function login(email) {
  const response = await fetch(`${API}/v1/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(HOST ? { host: HOST } : {}),
    },
    body: new URLSearchParams({ grant_type: 'password', username: email, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`Connexion ${email} : ${response.status}`);
  return (await response.json()).access_token;
}

async function upload(token) {
  const { file, upload } = await call(token, 'POST', '/demo/files/upload', {
    name: 'signature.png',
    mimeType: 'image/png',
    size: PNG.length,
  });
  const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: PNG });
  if (!put.ok) throw new Error(`Dépôt du fichier : ${put.status}`);
  await call(token, 'POST', `/demo/files/${file.id}/complete`);
  return file.id;
}

async function until(read, label, timeout = 60_000) {
  const start = Date.now();
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Délai dépassé : ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const started = new Date();
const technicien = await login('technicien@wasafili.local');
const superviseur = await login('superviseur@wasafili.local');

const structures = await call(technicien, 'GET', '/demo/structures?per_page=100');
const structure = structures.data.find((s) => s.name === 'Inspection équipement');
const lists = await call(technicien, 'GET', '/demo/lists?per_page=100');
const list = lists.data.find((l) => l.name === 'Sites et équipements');
const items = (await call(technicien, 'GET', `/demo/lists/${list.id}/items?per_page=100`)).data;
const byCode = Object.fromEntries(items.map((item) => [item.code, item.id]));

const signature = await upload(technicien);
const fiche = await call(technicien, 'POST', `/demo/structures/${structure.id}/submissions`, {
  data: {
    site: byCode['S-PLT'],
    batiment: byCode['B-PLT-A'],
    equipement: byCode['EQ-0003'],
    date_inspection: started.toISOString().slice(0, 10),
    etat: 'bon',
    signature: { fileId: signature },
  },
});
step(`Fiche ${fiche.id} saisie par le technicien`);
await call(technicien, 'POST', `/demo/submissions/${fiche.id}/transition`, {
  transition: 'soumettre',
});
step('Fiche soumise');
await call(superviseur, 'POST', `/demo/submissions/${fiche.id}/transition`, {
  transition: 'valider',
});
step('Fiche validée par le superviseur');

const message = await until(async () => {
  const { messages } = await (await fetch(`${MAILPIT}/api/v1/messages?limit=50`)).json();
  return messages.find(
    (m) =>
      new Date(m.Created) >= new Date(started.getTime() - 1000) &&
      m.To.some((to) => to.Address === 'technicien@wasafili.local') &&
      m.Subject.startsWith('Inspection validée'),
  );
}, 'e-mail dans Mailpit');
step(`E-mail reçu : « ${message.Subject} » → ${message.To.map((t) => t.Address).join(', ')}`);

const detail = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
const pdf = detail.Attachments.find((a) => a.ContentType === 'application/pdf');
if (!pdf) throw new Error('Pas de rapport PDF joint');
const bytes = Buffer.from(
  await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}/part/${pdf.PartID}`)).arrayBuffer(),
);
if (bytes.subarray(0, 5).toString() !== '%PDF-')
  throw new Error('La pièce jointe n’est pas un PDF');
if (!message.To.some((t) => t.Address === 'superviseur@wasafili.local')) {
  throw new Error('Le superviseur n’est pas destinataire');
}
step(`Rapport joint : ${pdf.FileName} (${bytes.length} octets, PDF valide)`);
console.log('\nAcceptation P5.5 : OK');
