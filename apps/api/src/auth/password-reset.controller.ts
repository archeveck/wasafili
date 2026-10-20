import { Body, Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import { type Request } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RateLimitByIp } from '../rate-limit/rate-limit.guard';
import { Public } from './decorators';
import { passwordSchema } from './password-policy';
import { PasswordResetService } from './password-reset.service';

const requestSchema = z.object({ email: z.string().trim().max(320) });
const confirmSchema = z.object({ token: z.string().min(1).max(200), password: passwordSchema });

const origin = (req: Request) => ({ ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });

@Controller('password-reset')
@Public()
export class PasswordResetController {
  constructor(private readonly resets: PasswordResetService) {}

  /**
   * Demande un lien de réinitialisation du mot de passe, envoyé par e-mail (valable 30 minutes).
   * La réponse est la même que le compte existe ou non.
   */
  @Post()
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @RateLimitByIp()
  request(
    @Body(new ZodValidationPipe(requestSchema)) body: z.infer<typeof requestSchema>,
    @Req() req: Request,
  ): void {
    this.resets.requestInBackground(body.email, origin(req));
  }

  /**
   * Choisit un nouveau mot de passe avec le jeton du lien reçu (usage unique). Toutes les
   * sessions du compte sont fermées.
   */
  @Post('confirm')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @RateLimitByIp()
  async confirm(
    @Body(new ZodValidationPipe(confirmSchema)) body: z.infer<typeof confirmSchema>,
    @Req() req: Request,
  ): Promise<void> {
    await this.resets.confirm(body.token, body.password, origin(req));
  }
}
