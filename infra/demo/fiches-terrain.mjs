#!/usr/bin/env node
/**
 * Données de démonstration de la Phase 6 : des inspections localisées autour des sites de
 * démo (Plateau, Yopougon), saisies par l'API comme sur le terrain (validation, historique,
 * automatisations). Alimente la carte, le suivi des équipes, les tableaux de bord et l'export
 * ZIP des photos.
 *
 *   node infra/demo/fiches-terrain.mjs [nombre]     # 24 par défaut
 *
 * Prérequis : instance de démo (`pnpm db:seed`) et API démarrée. Variables : API_URL, API_HOST.
 */
const API = process.env.API_URL ?? 'http://localhost:3000';
const HOST = process.env.API_HOST;
const PASSWORD = 'Tesserax2026!';
const COUNT = Number(process.argv[2] ?? 24);
// PNG 1×1 : signature et photo.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

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

async function upload(token, name) {
  const { file, upload } = await call(token, 'POST', '/demo/files/upload', {
    name,
    mimeType: 'image/png',
    size: PNG.length,
  });
  const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: PNG });
  if (!put.ok) throw new Error(`Dépôt du fichier : ${put.status}`);
  await call(token, 'POST', `/demo/files/${file.id}/complete`);
  return file.id;
}

/** Sites de démonstration et position approximative (WGS 84). */
const SITES = [
  {
    site: 'S-PLT',
    batiments: { 'B-PLT-A': ['EQ-0001', 'EQ-0002', 'EQ-0003'], 'B-PLT-B': ['EQ-0011'] },
    at: [5.3236, -4.0198],
  },
  { site: 'S-YOP', batiments: { 'B-YOP-3': ['EQ-0101', 'EQ-0102'] }, at: [5.3364, -4.0726] },
];
const ETATS = ['bon', 'bon', 'bon', 'degrade', 'hors_service'];
const pick = (list, i) => list[i % list.length];
const jitter = (value, i, scale) => value + Math.sin(i * 12.9898) * scale;

const technicien = await login('technicien@tesserax.local');
const superviseur = await login('superviseur@tesserax.local');
const structure = (await call(technicien, 'GET', '/demo/structures?per_page=100')).data.find(
  (s) => s.name === 'Inspection équipement',
);
const list = (await call(technicien, 'GET', '/demo/lists?per_page=100')).data.find(
  (l) => l.name === 'Sites et équipements',
);
const items = (await call(technicien, 'GET', `/demo/lists/${list.id}/items?per_page=100`)).data;
const byCode = Object.fromEntries(items.map((item) => [item.code, item.id]));
const today = new Date().toISOString().slice(0, 10);

for (let i = 0; i < COUNT; i += 1) {
  const site = pick(SITES, i);
  const batiment = pick(Object.keys(site.batiments), i);
  const equipement = pick(site.batiments[batiment], i);
  const etat = pick(ETATS, i);
  const lat = jitter(site.at[0], i, 0.004);
  const lng = jitter(site.at[1], i + 7, 0.004);
  const data = {
    site: byCode[site.site],
    batiment: byCode[batiment],
    equipement: byCode[equipement],
    date_inspection: today,
    etat,
    position: { lat, lng, source: 'gps', accuracy: 8 },
    signature: { fileId: await upload(technicien, 'signature.png') },
    ...(etat === 'bon'
      ? {}
      : {
          description_defaut: etat === 'hors_service' ? 'Arrêt complet constaté' : 'Usure visible',
          photos: [
            { fileId: await upload(technicien, `IMG_${1000 + i}.png`) },
            { fileId: await upload(technicien, `IMG_${2000 + i}.png`) },
          ],
        }),
  };
  const fiche = await call(technicien, 'POST', `/demo/structures/${structure.id}/submissions`, {
    data,
    location: { lat: lat + 0.0003, lng: lng - 0.0002, accuracy: 12 },
  });
  // Un tiers reste en brouillon, un tiers est soumis, un tiers validé.
  if (i % 3 >= 1) {
    await call(technicien, 'POST', `/demo/submissions/${fiche.id}/transition`, {
      transition: 'soumettre',
    });
  }
  if (i % 3 === 2) {
    await call(superviseur, 'POST', `/demo/submissions/${fiche.id}/transition`, {
      transition: 'valider',
    });
  }
  process.stdout.write('.');
}
console.log(`\n${COUNT} inspection(s) localisée(s) saisie(s) sur l’instance de démo.`);
