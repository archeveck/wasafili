import { expect, type Page, test } from '@playwright/test';

/** Captures d'écran facultatives (revue visuelle) : `SHOTS=<dossier> pnpm test:e2e`. */
const shot = async (page: Page, name: string) => {
  if (process.env['SHOTS']) await page.screenshot({ path: `${process.env['SHOTS']}/${name}.png` });
};

/**
 * Clés API (P7.1.4) : création avec des permissions choisies, secret montré une fois, jeton
 * `client_credentials` utilisable, révocation effective sur le jeton déjà émis.
 */
test('clé API : création, usage par une intégration, révocation immédiate', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('admin@wasafili.local');
  await page.getByLabel('Mot de passe').fill('Wasafili2026!');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/demo\/structures/);

  await page.getByRole('link', { name: 'Clés API' }).click();
  await page.getByRole('button', { name: 'Nouvelle clé' }).click();
  const name = `n8n e2e ${Date.now()}`;
  const dialog = page.getByRole('dialog', { name: 'Nouvelle clé API' });
  await dialog.getByLabel('Nom').fill(name);
  await dialog.getByRole('checkbox', { name: 'structure:read' }).check();
  await shot(page, 'cle-api-creation');
  await dialog.getByRole('button', { name: 'Créer la clé' }).click();

  const secretDialog = page.getByRole('dialog', { name: `Clé « ${name} »` });
  const clientId = await secretDialog.getByLabel('Identifiant (client_id)').inputValue();
  const clientSecret = await secretDialog.getByLabel('Secret (client_secret)').inputValue();
  expect(clientId).toMatch(/^wsf_/);
  expect(clientSecret).toMatch(/^wsfsk_/);
  await shot(page, 'cle-api-secret');
  await page.keyboard.press('Escape');

  // L'intégration obtient un jeton et lit les formulaires, mais rien d'autre.
  const token = await page.request.post('/v1/oauth/token', {
    form: { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret },
  });
  expect(token.ok()).toBe(true);
  const headers = { Authorization: `Bearer ${(await token.json()).access_token as string}` };
  expect((await page.request.get('/v1/demo/structures', { headers })).status()).toBe(200);
  expect((await page.request.get('/v1/demo/users', { headers })).status()).toBe(403);

  // Le secret n'est plus jamais affiché ; l'utilisation est tracée.
  await page.reload();
  const card = page.locator('div').filter({ hasText: name }).filter({ hasText: clientId }).last();
  await expect(card).toContainText('dernière utilisation');
  await expect(page.getByText(clientSecret)).toHaveCount(0);
  await shot(page, 'cles-api');

  page.once('dialog', (confirm) => void confirm.accept());
  await page.getByRole('button', { name: `Révoquer ${name}` }).click();
  await expect(page.getByText('Clé API révoquée')).toBeVisible();
  expect((await page.request.get('/v1/demo/structures', { headers })).status()).toBe(401);
});
