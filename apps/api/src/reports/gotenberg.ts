import {
  BadGatewayException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ENV, type Env } from '../config/env';

/**
 * Conversion DOCX → PDF (P5.1.3) par Gotenberg (LibreOffice isolé dans son conteneur) : l'API
 * ne fait qu'un appel HTTP, le travail lourd reste hors de son processus.
 */
@Injectable()
export class GotenbergClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async convert(docx: Buffer): Promise<Buffer> {
    if (!this.env.GOTENBERG_URL) {
      throw new ServiceUnavailableException({
        error: 'report_unavailable',
        message: 'Génération des rapports non configurée (GOTENBERG_URL)',
      });
    }
    const form = new FormData();
    form.append(
      'files',
      new Blob([new Uint8Array(docx)], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      'rapport.docx',
    );
    let response: Response;
    try {
      response = await fetch(new URL('/forms/libreoffice/convert', this.env.GOTENBERG_URL), {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(this.env.GOTENBERG_TIMEOUT_MS),
      });
    } catch (error) {
      throw new BadGatewayException({
        error: 'report_conversion_failed',
        message: `Conversion PDF impossible : ${(error as Error).message}`,
      });
    }
    if (!response.ok) {
      throw new BadGatewayException({
        error: 'report_conversion_failed',
        message: `Conversion PDF refusée (${response.status}) : ${(await response.text()).slice(0, 200)}`,
      });
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
