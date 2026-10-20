import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { pageArgs, type Pagination, toPage } from '../common/pagination';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type TransactionClient } from '../prisma/tenant';
import { JobQueue } from '../queue/queue.module';

export interface Attachment {
  key: string;
  filename: string;
  contentType: string;
}

export interface OutgoingEmail {
  to: string[];
  subject: string;
  text: string;
  /** Lien affiché en bouton (ex. vers la fiche dans le back-office). */
  link?: { label: string; url: string };
  attachments?: Attachment[];
  automationRunId?: string;
  step?: number;
}

const escapeHtml = (text: string) =>
  text.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/** Version HTML sobre d'un texte (paragraphes, bouton de lien), tout contenu échappé. */
export function emailHtml(
  text: string,
  instanceName: string,
  link?: OutgoingEmail['link'],
): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 12px">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const button = link
    ? `<p style="margin:20px 0"><a href="${escapeHtml(link.url)}" style="background:#1F4E79;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${escapeHtml(link.label)}</a></p>`
    : '';
  return `<!doctype html><html lang="fr"><body style="font-family:Arial,sans-serif;color:#1f2933;line-height:1.5;max-width:600px;margin:0 auto;padding:24px">${paragraphs}${button}<p style="margin-top:32px;color:#8a94a3;font-size:12px">${escapeHtml(instanceName)} — envoyé par Wasafili</p></body></html>`;
}

/**
 * Journal d'envoi (P5.2) : un e-mail est écrit dans la transaction qui le décide, puis envoyé
 * en SMTP par le worker (retentatives, statut). Aucun envoi direct depuis l'API.
 */
@Injectable()
export class EmailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueue,
  ) {}

  async enqueue(
    tx: TransactionClient,
    instance: { id: string; name: string },
    email: OutgoingEmail,
  ) {
    const created = await tx.emailMessage.create({
      data: {
        instanceId: instance.id,
        to: email.to,
        subject: email.subject,
        text: email.link ? `${email.text}\n\n${email.link.label} : ${email.link.url}` : email.text,
        html: emailHtml(email.text, instance.name, email.link),
        attachments: (email.attachments ?? []) as unknown as Prisma.InputJsonValue,
        automationRunId: email.automationRunId ?? null,
        step: email.step ?? null,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** À appeler une fois la transaction validée. */
  async dispatch(instanceId: string, emailIds: string[]) {
    for (const emailId of emailIds)
      await this.queue.add('email', { instanceId, emailId }, `email-${emailId}`);
  }

  async list(input: Pagination & { status?: string }) {
    const where = input.status ? { status: input.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.db.emailMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(input),
        select: {
          id: true,
          to: true,
          subject: true,
          status: true,
          error: true,
          attempts: true,
          attachments: true,
          automationRunId: true,
          sentAt: true,
          createdAt: true,
        },
      }),
      this.prisma.db.emailMessage.count({ where }),
    ]);
    return toPage(
      rows.map(({ attachments, ...row }) => ({
        ...row,
        attachments: (attachments as unknown as Attachment[]).map((a) => a.filename),
      })),
      total,
      input,
    );
  }

  /** Renvoi manuel d'un e-mail en échec (après correction du SMTP, par exemple). */
  async retry(id: string) {
    const email = await this.prisma.db.emailMessage.findUnique({ where: { id } });
    if (!email) throw new NotFoundException({ error: 'not_found', message: 'E-mail introuvable' });
    if (email.status !== 'failed') {
      throw new ConflictException({
        error: 'conflict',
        message: 'Seul un e-mail en échec peut être renvoyé',
      });
    }
    await this.prisma.db.emailMessage.update({
      where: { id },
      data: { status: 'queued', error: null },
    });
    await this.queue.add(
      'email',
      { instanceId: email.instanceId, emailId: id },
      `email-${id}-${email.attempts}`,
    );
    return { id, status: 'queued' };
  }
}
