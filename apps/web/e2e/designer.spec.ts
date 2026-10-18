import { expect, type Page, test } from '@playwright/test';

/**
 * Parcours critique P2.3.6 : un administrateur crée un formulaire sans code (glisser-déposer,
 * propriétés, calcul, condition), le publie, puis saisit une fiche validée par le moteur.
 */
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('admin@tesserax.local');
  await page.getByLabel('Mot de passe').fill('Tesserax2026!');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/demo\/structures/);
}

async function dragTo(page: Page, source: string, target: string) {
  const from = await page.getByRole('button', { name: source, exact: true }).boundingBox();
  const to = await page.getByText(target).first().boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  // Plusieurs étapes : le capteur de dnd-kit démarre après 4 px de déplacement.
  await page.mouse.move(from!.x + 20, from!.y + 20, { steps: 5 });
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 15 });
  await page.mouse.up();
}

test('créer, publier un formulaire puis saisir une fiche', async ({ page }) => {
  const name = `Visite e2e ${Date.now()}`;
  await login(page);

  await page.getByRole('button', { name: 'Nouveau formulaire' }).click();
  await page.getByLabel('Nom').fill(name);
  await page.getByRole('button', { name: 'Créer et concevoir' }).click();
  await expect(page).toHaveURL(/\/designer$/);
  await expect(page.getByText('Glissez des champs ici')).toBeVisible();

  // Glisser-déposer depuis la palette.
  await dragTo(page, 'Ajouter : Texte court', 'Glissez des champs ici');
  await expect(page.getByTestId('field-texte_court')).toBeVisible();
  await page.getByLabel('Libellé').fill('Nom du site');
  await page.getByLabel('Clé').fill('nom_site');
  await page.getByLabel('Obligatoire', { exact: true }).click();

  // Ajout par clic : nombre et calcul.
  await page.getByRole('button', { name: 'Ajouter : Nombre', exact: true }).click();
  await page.getByLabel('Libellé').fill('Quantité');
  await page.getByLabel('Clé').fill('quantite');
  await page.getByRole('button', { name: 'Ajouter : Calcul', exact: true }).click();
  await page.getByLabel('Libellé').fill('Double');
  await page.getByLabel('Clé').fill('double');
  await page.getByLabel('Formule').fill('{quantite} *');
  await expect(page.getByText(/Formule incomplète/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publier' })).toBeDisabled();
  await page.getByLabel('Formule').fill('{quantite} * 2');

  // Condition : « Double » visible seulement si une quantité est saisie.
  await page.getByRole('button', { name: 'Ajouter une règle' }).first().click();
  await page.getByLabel('Champ', { exact: true }).first().selectOption('quantite');
  await page.getByLabel('Opérateur', { exact: true }).first().selectOption('filled');

  // Aperçu mobile live : le calcul et la condition s'appliquent.
  await page.getByRole('tab', { name: /Aperçu mobile/ }).click();
  const doubleInPreview = page.locator('label[for="preview-double"]');
  await expect(doubleInPreview).toHaveCount(0); // masqué tant que la quantité est vide
  await page.locator('#preview-quantite').fill('21');
  await expect(doubleInPreview).toBeVisible();
  await expect(page.getByText('42', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Publier' }).click();
  await expect(page.getByText('Version 1 publiée')).toBeVisible();

  // Saisie d'une fiche avec le formulaire publié.
  await page.getByRole('link', { name: 'Retour aux formulaires' }).click();
  await page.getByRole('link', { name }).click();
  await page.getByRole('link', { name: 'Nouvelle fiche' }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Ce champ est obligatoire')).toBeVisible();
  await page.getByLabel('Nom du site').fill('Plateau');
  await page.getByLabel('Quantité').fill('5');
  await expect(page.getByText('10', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Fiche enregistrée')).toBeVisible();
  await expect(page).toHaveURL(/\/submissions\/[0-9a-f-]+$/);

  await page.getByRole('tab', { name: 'Historique' }).click();
  await expect(page.getByText('Création')).toBeVisible();
});
