import { expect, type Page, test } from '@playwright/test';

/**
 * Parcours de la Phase 5 : modèle de rapport de démonstration (balises vérifiées, aperçu PDF),
 * automatisation configurée sans code, rapport PDF d'une fiche et webhook signé.
 */
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('admin@wasafili.local');
  await page.getByLabel('Mot de passe').fill('Wasafili2026!');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/demo\/structures/);
}

test('rapports : modèle conforme, aperçu PDF et rapport d’une fiche', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Actions pour Inspection équipement' }).click();
  await page.getByRole('menuitem', { name: 'Rapports' }).click();
  await expect(page.getByText("Rapport d'inspection", { exact: true })).toBeVisible();
  await expect(page.getByText('Balises conformes au formulaire')).toBeVisible();
  await expect(page.getByRole('button', { name: /\{\{@signature\}\}/ })).toBeVisible();

  // Le PDF s'ouvre dans un nouvel onglet (Chromium sans interface le télécharge).
  const pdf = () =>
    page
      .context()
      .waitForEvent('request', { predicate: (request) => /\.pdf\?/.test(request.url()) });
  const preview = pdf();
  await page.getByRole('button', { name: 'Aperçu PDF' }).click();
  await preview;

  // Rapport d'une fiche existante.
  await page.getByRole('link', { name: 'Formulaires' }).click();
  await page.getByRole('link', { name: 'Inspection équipement' }).click();
  await page.locator('tbody tr').first().click();
  await expect(page).toHaveURL(/\/submissions\/[0-9a-f-]+$/);
  const report = pdf();
  await page.getByRole('button', { name: 'Rapport PDF' }).click();
  expect((await report).url()).toContain('/reports/');
});

test('automatisation : configurer « validation → e-mail avec rapport » sans code', async ({
  page,
}) => {
  const name = `Alerte e2e ${Date.now()}`;
  await login(page);
  await page.getByRole('link', { name: 'Automatisations' }).click();
  await expect(
    page.getByRole('link', { name: 'Rapport PDF à la validation', exact: true }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Nouvelle automatisation' }).click();
  await page.getByLabel('Nom').fill(name);
  await page.getByLabel('Formulaire surveillé').selectOption({ label: 'Inspection équipement' });
  await page.getByRole('group', { name: 'États' }).getByText('Rejeté').click();
  await page.getByRole('button', { name: 'Ajouter une action' }).click();
  await page.getByRole('menuitem', { name: 'Envoyer un e-mail' }).click();
  await page.getByLabel('Adresse e-mail').fill('qualite@exemple.ci');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByLabel('Joindre le rapport PDF').selectOption({ label: "Rapport d'inspection" });
  await page.getByRole('button', { name: 'Ajouter une action' }).click();
  await page.getByRole('menuitem', { name: 'Modifier un champ' }).click();
  // Champ calculé : refusé par le serveur, avec l'explication.
  await page.getByLabel('Champ').selectOption({ label: 'Description du défaut' });
  await page.getByLabel('Nouvelle valeur').fill('À reprendre');
  await page.getByRole('button', { name: 'Enregistrer' }).click();

  await expect(page).toHaveURL(/\/demo\/automations$/);
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText("Changement d'état → rejete");
  await expect(row).toContainText('Envoyer un e-mail → Modifier un champ');

  await row.getByRole('switch').click();
  await expect(row.getByRole('switch')).not.toBeChecked();
  page.once('dialog', (dialog) => void dialog.accept());
  await row.getByRole('button', { name: `Supprimer ${name}` }).click();
  await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Exécutions' }).click();
  await expect(page).toHaveURL(/tab=runs/);
  await page.getByRole('tab', { name: 'E-mails envoyés' }).click();
  await expect(page.getByText('Inspection validée', { exact: false }).first()).toBeVisible();
});

test('webhook : secret affiché une fois, test de livraison journalisé', async ({ page }) => {
  const name = `Webhook e2e ${Date.now()}`;
  await login(page);
  await page.goto('/demo/automations?tab=webhooks');
  await page.getByRole('button', { name: 'Nouveau webhook' }).click();
  await page.getByLabel('Nom').fill(name);
  await page.getByLabel('URL').fill('https://hooks.invalid/wasafili');
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByRole('textbox', { name: 'Secret' })).toHaveValue(/^whsec_/);
  await page.keyboard.press('Escape');

  const card = page.locator('div.rounded-lg', { hasText: name }).last();
  await card.getByRole('button', { name: 'Tester' }).click();
  await expect(card.getByText('ping')).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await card.getByRole('button', { name: `Supprimer ${name}` }).click();
  await expect(page.getByText(name)).toHaveCount(0);
});
