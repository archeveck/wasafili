import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ENV, type Env } from '../config/env';
import { emailHtml } from '../emails/emails.service';
import { PrismaService } from '../prisma/prisma.service';
import { JobQueue } from '../queue/queue.module';
import { hashPassword, randomToken, sha256 } from './crypto';
import { type RequestOrigin } from './auth.service';
import { TokensService } from './tokens.service';

/** Durée de validité d'un lien de réinitialisation. */
export const RESET_TOKEN_TTL_MS = 30 * 60_000;
/** Délai minimal entre deux e-mails pour un même compte (pas d'envoi en rafale). */
export const RESET_RESEND_DELAY_MS = 2 * 60_000;
/** Page du back-office qui reçoit le lien ; le jeton est dans le fragment (jamais envoyé au serveur). */
export const RESET_PAGE_PATH = '/mot-de-passe/nouveau';

const invalidToken = () =>
  new BadRequestException({
    error: 'invalid_token',
    message: 'Lien invalide ou expiré : faites une nouvelle demande',
  });

/**
 * Mot de passe oublié en libre-service (ASVS 2.5, ADR 0013). La demande ne révèle jamais si le
 * compte existe ; le lien envoyé porte un jeton aléatoire de 256 bits, à usage unique, valable
 * 30 minutes, stocké haché. Le nouveau mot de passe ferme toutes les sessions.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
    private readonly queue: JobQueue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Lance la demande sans l'attendre : la réponse part avant toute écriture, si bien que sa
   * durée ne distingue pas un compte existant d'un e-mail inconnu.
   */
  requestInBackground(email: string, origin: RequestOrigin): void {
    this.request(email, origin).catch((err: unknown) =>
      this.logger.error({ err }, 'demande de réinitialisation du mot de passe'),
    );
  }

  async request(email: string, origin: RequestOrigin = {}): Promise<void> {
    const db = this.prisma.db;
    const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user?.isActive) return;
    const now = new Date();
    const recent = await db.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        createdAt: { gt: new Date(now.getTime() - RESET_RESEND_DELAY_MS) },
      },
      select: { id: true },
    });
    if (recent) return;

    const token = randomToken();
    const created = await this.prisma.transaction(async (tx) => {
      // Une seule demande en cours : la plus récente remplace les précédentes.
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      return tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
        },
        select: { id: true },
      });
    });

    const url = `${this.env.APP_URL}${RESET_PAGE_PATH}#token=${token}`;
    const text =
      `Bonjour ${user.firstName},\n\n` +
      'Une réinitialisation du mot de passe de votre compte Wasafili a été demandée. ' +
      'Le lien ci-dessous est valable 30 minutes et ne sert qu’une fois.\n\n' +
      'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : ' +
      'votre mot de passe reste inchangé.';
    const link = { label: 'Choisir un nouveau mot de passe', url };
    await this.queue.add(
      'account-email',
      {
        to: user.email,
        subject: 'Réinitialisation de votre mot de passe',
        text: `${text}\n\n${link.label} : ${url}`,
        html: emailHtml(text, 'Votre compte', link),
      },
      `account-email-${created.id}`,
    );
    await this.audit.recordForUser(user.id, { action: 'auth.password_reset_request', ...origin });
  }

  /** Nouveau mot de passe à partir du lien : jeton consommé, sessions fermées. */
  async confirm(token: string, password: string, origin: RequestOrigin = {}): Promise<void> {
    const record = await this.prisma.db.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { isActive: true, email: true, firstName: true } } },
    });
    const now = new Date();
    if (!record || record.usedAt || record.expiresAt <= now || !record.user.isActive) {
      throw invalidToken();
    }
    const passwordHash = await hashPassword(password);
    await this.prisma.transaction(async (tx) => {
      // Consommation atomique : deux envois simultanés du même lien, un seul réussit.
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) throw invalidToken();
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: now },
      });
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    });
    await this.tokens.revokeAllForUser(record.userId);
    await this.audit.recordForUser(record.userId, { action: 'auth.password_reset', ...origin });
    // Avis au titulaire (ASVS 2.2.3) : un changement qu'il n'a pas fait doit l'alerter.
    const text =
      `Bonjour ${record.user.firstName},\n\n` +
      'Le mot de passe de votre compte Wasafili vient d’être changé avec un lien de ' +
      'réinitialisation, et vos sessions ont été fermées.\n\n' +
      'Si vous n’êtes pas à l’origine de ce changement, prévenez sans attendre un ' +
      'administrateur de votre espace.';
    await this.queue.add(
      'account-email',
      {
        to: record.user.email,
        subject: 'Votre mot de passe a été changé',
        text,
        html: emailHtml(text, 'Votre compte'),
      },
      `account-email-${record.id}-done`,
    );
  }
}
