import { expect, type Page, test } from '@playwright/test';

/**
 * Parcours de la Phase 6 : carte des fiches, suivi des équipes, tableau de bord de démo et
 * édition d'un widget, export ZIP des photos (préparé par le worker) et journal d'audit.
 * Données : `pnpm db:seed` puis `node infra/demo/fiches-terrain.mjs` (fiches localisées).
 */
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('admin@wasafili.local');
  await page.getByLabel('Mot de passe').fill('Wasafili2026!');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/demo\/structures/);
}

/** Captures d'écran facultatives (revue visuelle) : `SHOTS=<dossier> pnpm test:e2e`. */
const shot = async (page: Page, name: string) => {
  if (process.env['SHOTS']) await page.screenshot({ path: `${process.env['SHOTS']}/${name}.png` });
};

test('carte des fiches et suivi des équipes', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Inspection équipement' }).click();
  await page.getByRole('tab', { name: 'Carte' }).click();
  await expect(page.getByText(/[1-9]\d* fiche\(s\) localisée\(s\)/)).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Carte des fiches' }).locator('canvas'),
  ).toBeVisible();
  // Les filtres du tableau s'appliquent à la carte.
  await page.getByRole('button', { name: /Validé/ }).click();
  await expect(page.getByText(/fiche\(s\) localisée\(s\)/)).toBeVisible();
  await page.waitForTimeout(1500); // tuiles du fond de carte
  await shot(page, 'carte');

  await page.getByRole('link', { name: 'Équipes terrain' }).click();
  await expect(page.getByRole('button', { name: /Mamadou Traoré/ })).toBeVisible();
  await page.getByRole('button', { name: /Mamadou Traoré/ }).click();
  await expect(page.getByRole('link', { name: 'Voir la fiche' })).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, 'equipes');
});

test('tableau de bord : widgets calculés, ajout d’un widget', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Tableaux de bord' }).click();
  await page.getByRole('link', { name: /Suivi des inspections/ }).click();
  await expect(page.getByRole('region', { name: 'Inspections (30 jours)' })).toContainText(/\d/);
  await expect(page.getByRole('region', { name: 'État des équipements' })).toContainText('Bon');
  await expect(page.getByRole('img', { name: /^Courbe sur \d+ périodes/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Inspections par inspecteur' })).toContainText(
    /\d/,
  );
  await shot(page, 'tableau-de-bord');

  // Vue tableau d'un graphique (lecture exacte, accessibilité).
  const etats = page.getByRole('region', { name: 'Fiches par état' });
  await etats.getByRole('button', { name: 'Afficher les données' }).click();
  await expect(etats.getByRole('cell', { name: 'Validé' })).toBeVisible();

  await page.getByRole('button', { name: 'Modifier' }).click();
  await page.getByRole('button', { name: 'Widget' }).click();
  const dialog = page.getByRole('dialog', { name: 'Widget' });
  await dialog.getByLabel('Titre').fill('Hors service par site');
  await dialog.getByLabel('Formulaire').selectOption({ label: 'Inspection équipement' });
  await dialog.getByLabel('Affichage').selectOption('bar');
  await dialog.getByLabel('Regrouper par').selectOption({ label: 'Équipement' });
  await expect(dialog.getByRole('region', { name: 'Hors service par site' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Valider' }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Tableau de bord enregistré')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Hors service par site' })).toBeVisible();

  // Remise en l'état de la démo.
  await page.getByRole('button', { name: 'Modifier' }).click();
  await page.getByRole('button', { name: 'Retirer « Hors service par site »' }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Tableau de bord enregistré').first()).toBeVisible();
});

test('export ZIP des photos puis trace dans le journal d’audit', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Inspection équipement' }).click();
  await page.getByRole('button', { name: 'Photos (ZIP)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Exporter les photos (ZIP)' });
  await dialog.getByRole('button', { name: 'Préparer l’archive' }).click();
  await expect(dialog.getByText(/Archive prête/)).toBeVisible({ timeout: 60_000 });
  await shot(page, 'export-photos');
  // Le lien signé pointe vers le stockage, qui sert l'archive en pièce jointe.
  const request = page.waitForRequest(
    (r) => r.url().includes('/exports/') && r.url().includes('.zip'),
  );
  await dialog.getByRole('button', { name: 'Télécharger' }).click();
  const url = (await request).url();
  const archive = await page.request.get(url);
  expect(archive.ok()).toBe(true);
  expect((await archive.body()).subarray(0, 2).toString()).toBe('PK');
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'Journal d’audit' }).click();
  await page.getByLabel('Action').selectOption({ label: 'Exports' });
  await expect(page.getByRole('cell', { name: 'Export des photos (ZIP)' }).first()).toBeVisible();
  await page.getByLabel('Action').selectOption({ label: 'Connexions et clés API' });
  await expect(page.getByRole('cell', { name: 'Connexion', exact: true }).first()).toBeVisible();
  await shot(page, 'audit');
});
