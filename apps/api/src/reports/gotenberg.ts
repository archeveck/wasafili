import {
  BadGatewayException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ENV, type Env } from '../config/env';

/**
 * Conversions PDF par Gotenberg, isolé dans son conteneur : DOCX → PDF (LibreOffice, rapports,
 * P5.1.3) et HTML → PDF (Chromium, export d'une liste de fiches). L'API ne fait qu'un appel
 * HTTP, le travail lourd reste hors de son processus.
 */
@Injectable()
export class GotenbergClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async convert(docx: Buffer): Promise<Buffer> {
    const form = new FormData();
    form.append(
      'files',
      new Blob([new Uint8Array(docx)], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      'rapport.docx',
    );
    return this.post('/forms/libreoffice/convert', form, 'report');
  }

  /**
   * Page HTML autonome (aucune ressource externe) en PDF A4 paysage. Le HTML est produit par
   * l'API, chaque valeur saisie échappée.
   */
  async htmlToPdf(html: string): Promise<Buffer> {
    const form = new FormData();
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
    form.append('paperWidth', '8.27');
    form.append('paperHeight', '11.7');
    form.append('landscape', 'true');
    for (const side of ['marginTop', 'marginBottom', 'marginLeft', 'marginRight']) {
      form.append(side, '0.4');
    }
    form.append('printBackground', 'true');
    return this.post('/forms/chromium/convert/html', form, 'pdf');
  }

  private async post(route: string, form: FormData, kind: 'report' | 'pdf'): Promise<Buffer> {
    if (!this.env.GOTENBERG_URL) {
      throw new ServiceUnavailableException({
        error: `${kind}_unavailable`,
        message: 'Génération des PDF non configurée (GOTENBERG_URL)',
      });
    }
    let response: Response;
    try {
      response = await fetch(new URL(route, this.env.GOTENBERG_URL), {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(this.env.GOTENBERG_TIMEOUT_MS),
      });
    } catch (error) {
      throw new BadGatewayException({
        error: `${kind}_conversion_failed`,
        message: `Conversion PDF impossible : ${(error as Error).message}`,
      });
    }
    if (!response.ok) {
      throw new BadGatewayException({
        error: `${kind}_conversion_failed`,
        message: `Conversion PDF refusée (${response.status}) : ${(await response.text()).slice(0, 200)}`,
      });
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
