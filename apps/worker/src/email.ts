import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { type EmailJob } from '@wasafili/jobs';
import { type Pool } from 'pg';
import { inInstance } from './db.js';

export interface Mail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; content: Buffer; contentType: string }[];
}

/** Transport SMTP (nodemailer) ; remplaçable dans les tests. */
export interface Mailer {
  sendMail(mail: Mail): Promise<{ messageId?: string }>;
}

export interface EmailDeps {
  db: Pool;
  s3: S3Client;
  bucket: string;
  /** Absent : SMTP non configuré, l'e-mail échoue avec une explication. */
  mailer: Mailer | undefined;
  from: string;
  /** Dernière tentative : un échec est définitif (statut `failed`). */
  final: boolean;
}

interface EmailRow {
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments: { key: string; filename: string; contentType: string }[];
  status: string;
}

/**
 * Job `email` (P5.2, D5) : envoie un e-mail du journal d'envoi en SMTP, pièces jointes lues
 * dans le stockage. Un e-mail déjà envoyé n'est jamais renvoyé (job rejoué).
 */
export async function processEmail(job: EmailJob, deps: EmailDeps): Promise<'sent' | 'skipped'> {
  const email = await inInstance(deps.db, job.instanceId, async (client) => {
    const { rows } = await client.query<EmailRow>(
      'SELECT "to", subject, text, html, attachments, status FROM email_messages WHERE id = $1',
      [job.emailId],
    );
    return rows[0];
  });
  if (!email || email.status === 'sent') return 'skipped';

  const record = (fields: Record<string, unknown>) =>
    inInstance(deps.db, job.instanceId, (client) => {
      const keys = Object.keys(fields);
      return client.query(
        `UPDATE email_messages SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')},
           attempts = attempts + 1, updated_at = now() WHERE id = $1`,
        [job.emailId, ...Object.values(fields)],
      );
    });

  try {
    if (!deps.mailer) throw new Error('SMTP non configuré (SMTP_URL)');
    const attachments = await Promise.all(
      email.attachments.map(async (a) => {
        const object = await deps.s3.send(
          new GetObjectCommand({ Bucket: deps.bucket, Key: a.key }),
        );
        return {
          filename: a.filename,
          contentType: a.contentType,
          content: Buffer.from(await object.Body!.transformToByteArray()),
        };
      }),
    );
    const info = await deps.mailer.sendMail({
      from: deps.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      attachments,
    });
    await record({
      status: 'sent',
      error: null,
      message_id: info.messageId ?? null,
      sent_at: new Date(),
    });
    return 'sent';
  } catch (error) {
    await record({
      status: deps.final ? 'failed' : 'queued',
      error: (error as Error).message.slice(0, 1000),
    });
    throw error;
  }
}
