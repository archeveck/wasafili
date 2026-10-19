import { type Prisma, type PrismaClient } from '../generated/prisma/client';
import { tenantTransaction } from '../prisma/tenant';

const DASHBOARD_NAME = 'Suivi des inspections';

/**
 * Démonstration de la Phase 6 : tableau de bord « Suivi des inspections » sur la structure
 * de démonstration (volume, validations, états, rythme de saisie, inspecteurs). Idempotent.
 */
export async function seedDemoDashboard(
  client: PrismaClient,
  options: { instanceId: string; structureId: string },
) {
  const { instanceId, structureId } = options;
  const base = { structureId, filters: [] };
  const widgets = [
    {
      id: 'fiches',
      type: 'kpi',
      title: 'Inspections (30 jours)',
      width: 1,
      metric: { op: 'count' },
      period: '30d',
    },
    {
      id: 'validees',
      type: 'kpi',
      title: 'Inspections validées',
      width: 1,
      metric: { op: 'count' },
      state: 'valide',
      period: '30d',
    },
    {
      id: 'hors-service',
      type: 'kpi',
      title: 'Équipements hors service',
      width: 1,
      metric: { op: 'count' },
      period: '30d',
      filters: [{ key: 'etat', operator: 'eq', value: 'hors_service' }],
    },
    {
      id: 'etats',
      type: 'bar',
      title: 'Fiches par état',
      width: 1,
      metric: { op: 'count' },
      groupBy: { kind: 'state' },
      period: '30d',
    },
    {
      id: 'rythme',
      type: 'line',
      title: 'Inspections par jour',
      width: 2,
      metric: { op: 'count' },
      groupBy: { kind: 'period', unit: 'day' },
      period: '30d',
    },
    {
      id: 'constat',
      type: 'bar',
      title: 'État des équipements',
      width: 1,
      metric: { op: 'count' },
      groupBy: { kind: 'field', field: 'etat' },
      period: '90d',
    },
    {
      id: 'inspecteurs',
      type: 'bar',
      title: 'Inspections par inspecteur',
      width: 1,
      metric: { op: 'count' },
      groupBy: { kind: 'author' },
      period: '90d',
    },
  ].map((widget) => ({ ...base, ...widget }));

  return tenantTransaction(client, { instanceId }, async (tx) => {
    const existing = await tx.dashboard.findFirst({ where: { name: DASHBOARD_NAME } });
    if (existing) return existing;
    return tx.dashboard.create({
      data: {
        instanceId,
        name: DASHBOARD_NAME,
        description: 'Volume, validations et état du parc inspecté',
        widgets: widgets as Prisma.InputJsonArray,
      },
    });
  });
}
