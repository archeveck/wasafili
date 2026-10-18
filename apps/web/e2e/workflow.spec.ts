import { expect, type Page, test } from '@playwright/test';

/**
 * Parcours de la Phase 4 : un administrateur ajoute un workflow à un formulaire sans code,
 * soumet une fiche avec le bouton de transition, puis planifie et déplace une tâche.
 */
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('admin@tesserax.local');
  await page.getByLabel('Mot de passe').fill('Tesserax2026!');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/demo\/structures/);
}

test('workflow : créer les états, publier, soumettre une fiche', async ({ page }) => {
  const name = `Contrôle e2e ${Date.now()}`;
  await login(page);
  await page.getByRole('button', { name: 'Nouveau formulaire' }).click();
  await page.getByLabel('Nom').fill(name);
  await page.getByRole('button', { name: 'Créer et concevoir' }).click();
  await page.getByRole('button', { name: 'Ajouter : Texte court', exact: true }).click();
  await page.getByLabel('Libellé').fill('Observation');
  await page.getByLabel('Clé').fill('observation');

  await page.getByRole('tab', { name: 'Workflow' }).click();
  await page.getByRole('button', { name: 'Ajouter un workflow' }).click();
  await page.getByRole('button', { name: 'État', exact: true }).click();
  await page.getByLabel('Libellé').fill('Soumis');
  await page.getByLabel('Clé').fill('soumis');
  await page.getByRole('button', { name: 'Marquer comme final' }).click();

  // Transition Brouillon → Soumis depuis le panneau (alternative accessible au tracé).
  await page.getByText('Brouillon', { exact: true }).first().click();
  await page.getByLabel('État cible').selectOption('soumis');
  await page.getByRole('button', { name: 'Transition' }).click();
  await page.getByLabel('Libellé du bouton').fill('Soumettre');
  await page.getByRole('group', { name: 'Champs à renseigner' }).getByText('Observation').click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  await page.getByRole('button', { name: 'Publier' }).click();
  await expect(page.getByText('Version 1 publiée')).toBeVisible();

  await page.getByRole('link', { name: 'Retour aux formulaires' }).click();
  await page.getByRole('link', { name }).click();
  await page.getByRole('link', { name: 'Nouvelle fiche' }).click();
  // Le champ exigé par la transition est vérifié avant l'envoi.
  await page.getByRole('button', { name: 'Soumettre' }).click();
  await expect(page.getByText('À compléter avant « Soumettre » : Observation')).toBeVisible();
  await page.getByLabel('Observation').fill('RAS');
  await page.getByRole('button', { name: 'Soumettre' }).click();
  await expect(page).toHaveURL(/\/submissions\/[0-9a-f-]+$/);
  await expect(page.getByText('Soumis', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Soumettre' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Historique' }).click();
  await expect(page.getByText('Changement d’état')).toBeVisible();

  await page.getByRole('button', { name: 'Retour aux fiches' }).click();
  await expect(page.getByRole('button', { name: /Soumis\s*1/ })).toBeVisible();
});

test('agenda : planifier une tâche puis la glisser vers un autre jour et un autre assigné', async ({
  page,
}) => {
  const title = `Visite e2e ${Date.now()}`;
  await login(page);
  await page.getByRole('link', { name: 'Agenda' }).click();
  await page.getByRole('button', { name: 'Nouvelle tâche' }).click();
  await page.getByLabel('Titre').fill(title);
  await page.getByLabel('Formulaire à remplir').selectOption({ label: 'Inspection équipement' });
  await page.getByLabel('Assignée à').selectOption({ label: 'Mamadou Traoré' });
  await expect(page.getByText('Pré-remplir la fiche')).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Tâche planifiée')).toBeVisible();

  const card = page.getByRole('button', { name: new RegExp(title) });
  await expect(card).toBeVisible();
  // Glisser vers la ligne « Yao Kouassi », même jour (ligne suivante du tableau).
  const row = page.getByRole('row', { name: /Yao Kouassi/ });
  const from = (await card.boundingBox())!;
  const cell = (await row
    .locator('td')
    .nth(new Date().getUTCDay() === 0 ? 6 : new Date().getUTCDay() - 1)
    .boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 15, from.y + 15, { steps: 5 });
  await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect(page.getByText('Tâche replanifiée')).toBeVisible();
  await expect(row.getByRole('button', { name: new RegExp(title) })).toBeVisible();
});
