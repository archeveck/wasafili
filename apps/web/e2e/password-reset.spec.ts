import { expect, type Page, test } from '@playwright/test';

/**
 * Mot de passe oublié (ASVS 2.5, ADR 0013) : lien reçu par e-mail (Mailpit), nouveau mot de
 * passe, connexion. Prérequis : worker démarré (relais SMTP), Mailpit (`MAILPIT_URL`). Un même
 * compte ne reçoit qu'un e-mail toutes les 2 minutes : relancer le parcours après ce délai.
 */
const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';
const EMAIL = 'superviseur@wasafili.local';
const INITIAL = 'Wasafili2026!';
const NEXT = 'une autre phrase de passe du terrain';

interface MailpitMessage {
  ID: string;
  Subject: string;
  Created: string;
  To: { Address: string }[];
}

async function resetLink(since: Date): Promise<URL> {
  let link: URL | undefined;
  await expect
    .poll(
      async () => {
        const { messages } = (await (
          await fetch(`${MAILPIT}/api/v1/messages?limit=20`)
        ).json()) as { messages: MailpitMessage[] };
        const message = messages.find(
          (m) =>
            m.Subject === 'Réinitialisation de votre mot de passe' &&
            m.To.some((to) => to.Address === EMAIL) &&
            new Date(m.Created) >= since,
        );
        if (!message) return false;
        const detail = (await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json()) as {
          Text: string;
        };
        const url = /https?:\/\/\S+#token=[\w-]+/.exec(detail.Text)?.[0];
        link = url ? new URL(url) : undefined;
        return Boolean(link);
      },
      { timeout: 30_000, message: 'e-mail de réinitialisation reçu dans Mailpit' },
    )
    .toBe(true);
  return link!;
}

async function login(page: Page, password: string) {
  await page.getByLabel('Adresse e-mail').fill(EMAIL);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

test('mot de passe oublié : lien par e-mail, nouveau mot de passe, connexion', async ({ page }) => {
  const since = new Date(Date.now() - 1_000);
  await page.goto('/login');
  await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click();
  await page.getByLabel('Adresse e-mail').fill(EMAIL);
  await page.getByRole('button', { name: 'Envoyer le lien' }).click();
  await expect(page.getByText(`Si un compte existe pour ${EMAIL}`)).toBeVisible();

  const link = await resetLink(since);
  // Lien construit sur APP_URL : ouvert sur le back-office testé, fragment compris.
  await page.goto(`${link.pathname}${link.hash}`);
  await expect(page).not.toHaveURL(/token=/);
  await page.getByLabel('Nouveau mot de passe').fill(NEXT);
  await page.getByLabel('Confirmation').fill(NEXT);
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
  await expect(page.getByText('Mot de passe changé : connectez-vous')).toBeVisible();

  const refused = await page.request.post('/v1/oauth/token', {
    data: { grant_type: 'password', username: EMAIL, password: INITIAL },
  });
  expect(refused.status()).toBe(400);

  // Lien à usage unique.
  await page.goto(`${link.pathname}${link.hash}`);
  await page.getByLabel('Nouveau mot de passe').fill(`${NEXT} bis`);
  await page.getByLabel('Confirmation').fill(`${NEXT} bis`);
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
  await expect(page.getByRole('alert')).toContainText('invalide ou a expiré');

  // Connexion avec le nouveau mot de passe, puis remise en l'état de la démo.
  await page.goto('/login');
  await login(page, NEXT);
  await expect(page).toHaveURL(/\/demo\//);
  await page.getByRole('button', { name: 'Yao Kouassi' }).click();
  await page.getByRole('menuitem', { name: 'Changer mon mot de passe' }).click();
  const dialog = page.getByRole('dialog', { name: 'Changer mon mot de passe' });
  await dialog.getByLabel('Mot de passe actuel').fill(NEXT);
  await dialog.getByLabel('Nouveau mot de passe').fill(INITIAL);
  await dialog.getByLabel('Confirmation').fill(INITIAL);
  await dialog.getByRole('button', { name: 'Changer le mot de passe' }).click();
  await expect(page.getByText(/Mot de passe changé/)).toBeVisible();
});
