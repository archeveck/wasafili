import { expect, type Page, test } from '@playwright/test';

const EMAIL = 'technicien@wasafili.local';
const INITIAL = 'Wasafili2026!';
const NEXT = 'une phrase de passe du terrain';

async function login(page: Page, password: string) {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill(EMAIL);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

async function changePassword(page: Page, current: string, next: string) {
  await page.getByRole('button', { name: 'Mamadou Traoré' }).click();
  await page.getByRole('menuitem', { name: 'Changer mon mot de passe' }).click();
  const dialog = page.getByRole('dialog', { name: 'Changer mon mot de passe' });
  await dialog.getByLabel('Mot de passe actuel').fill(current);
  await dialog.getByLabel('Nouveau mot de passe').fill(next);
  await dialog.getByLabel('Confirmation').fill(next);
  await dialog.getByRole('button', { name: 'Changer le mot de passe' }).click();
  await expect(page.getByText(/Mot de passe changé/)).toBeVisible();
}

/** Changement de mot de passe (ASVS 2.1.6) : l'ancien est refusé, le nouveau accepté. */
test('changer son mot de passe depuis le menu utilisateur', async ({ page }) => {
  await login(page, INITIAL);
  await expect(page).toHaveURL(/\/demo\//);
  await changePassword(page, INITIAL, NEXT);
  // Toujours connecté (reconnexion automatique avec le nouveau mot de passe).
  await page.reload();
  await expect(page.getByRole('link', { name: 'Formulaires' })).toBeVisible();

  const refused = await page.request.post('/v1/oauth/token', {
    data: { grant_type: 'password', username: EMAIL, password: INITIAL },
  });
  expect(refused.status()).toBe(400);

  // Remise en l'état de la démo.
  await changePassword(page, NEXT, INITIAL);
});
