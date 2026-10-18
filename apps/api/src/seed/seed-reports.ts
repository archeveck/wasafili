import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { type Prisma, type PrismaClient } from '../generated/prisma/client';
import { tenantTransaction } from '../prisma/tenant';
import { demoReportDocx } from '../reports/demo-template';
import { inspectTemplate } from '../reports/docx';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const REPORT_NAME = "Rapport d'inspection";
const AUTOMATION_NAME = 'Rapport PDF à la validation';

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Démonstration de la Phase 5 : modèle « Rapport d'inspection » et automatisation qui envoie
 * le PDF par e-mail à l'auteur et au superviseur à la validation de la fiche. Idempotent.
 */
export async function seedDemoReports(
  client: PrismaClient,
  options: { instanceId: string; structureId: string; supervisorId: string; s3: S3Settings },
) {
  const { instanceId, structureId } = options;
  return tenantTransaction(client, { instanceId }, async (tx) => {
    let report = await tx.reportTemplate.findFirst({ where: { structureId, name: REPORT_NAME } });
    if (!report) {
      const docx = demoReportDocx();
      const id = crypto.randomUUID();
      const key = `${instanceId}/${id}`;
      const s3 = new S3Client({
        endpoint: options.s3.endpoint,
        region: options.s3.region,
        forcePathStyle: true,
        credentials: {
          accessKeyId: options.s3.accessKeyId,
          secretAccessKey: options.s3.secretAccessKey,
        },
      });
      await s3.send(
        new PutObjectCommand({
          Bucket: options.s3.bucket,
          Key: key,
          Body: docx,
          ContentType: DOCX,
        }),
      );
      await tx.file.create({
        data: {
          id,
          instanceId,
          key,
          name: 'rapport-inspection.docx',
          mimeType: DOCX,
          size: docx.length,
          status: 'uploaded',
        },
      });
      report = await tx.reportTemplate.create({
        data: {
          instanceId,
          structureId,
          name: REPORT_NAME,
          fileId: id,
          filename: 'Inspection {{equipement}} {{date_inspection}}',
          tags: inspectTemplate(docx) as unknown as Prisma.InputJsonValue,
        },
      });
    }
    let automation = await tx.automation.findFirst({
      where: { name: AUTOMATION_NAME, deletedAt: null },
    });
    if (!automation) {
      automation = await tx.automation.create({
        data: {
          instanceId,
          structureId,
          name: AUTOMATION_NAME,
          trigger: { type: 'state_changed', to: ['valide'] },
          actions: [
            {
              type: 'email',
              to: [{ type: 'author' }, { type: 'user', userId: options.supervisorId }],
              subject: 'Inspection validée : {{equipement}}',
              body:
                'Bonjour,\n\nL’inspection de « {{equipement}} » ({{site}}) réalisée par {{_auteur}} ' +
                'a été validée.\n\nÉtat constaté : {{etat}}. Le rapport PDF est joint.',
              reportId: report.id,
            },
          ],
        },
      });
    }
    return { report, automation };
  });
}
