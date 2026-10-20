import { describe, expect, it, vi } from 'vitest';
import { processAccountEmail } from './email.js';

const job = { to: 'awa@acme.ci', subject: 'Sujet', text: 'Texte', html: '<p>Texte</p>' };

describe('processAccountEmail', () => {
  it('envoie l’e-mail au seul destinataire, sans pièce jointe', async () => {
    const mailer = { sendMail: vi.fn(async () => ({ messageId: 'm1' })) };
    await processAccountEmail(job, { mailer, from: 'Wasafili <noreply@wasafili.local>' });
    expect(mailer.sendMail).toHaveBeenCalledWith({
      from: 'Wasafili <noreply@wasafili.local>',
      to: ['awa@acme.ci'],
      subject: 'Sujet',
      text: 'Texte',
      html: '<p>Texte</p>',
      attachments: [],
    });
  });

  it('échoue sans SMTP configuré (le job sera retenté)', async () => {
    await expect(processAccountEmail(job, { mailer: undefined, from: 'x' })).rejects.toThrow(
      /SMTP non configuré/,
    );
  });
});
