import { inspectionEquipement } from '@tesserax/form-schema';
import { type Prisma, type PrismaClient } from '../generated/prisma/client';
import { tenantTransaction } from '../prisma/tenant';

interface DemoItem {
  code: string;
  label: string;
  attributes?: Record<string, string>;
  children?: DemoItem[];
}

const SITES: DemoItem[] = [
  {
    code: 'S-PLT',
    label: 'Plateau — Tour Alpha',
    children: [
      {
        code: 'B-PLT-A',
        label: 'Bâtiment A',
        children: [
          { code: 'EQ-0001', label: 'Groupe électrogène 250 kVA', attributes: { marque: 'SDMO' } },
          { code: 'EQ-0002', label: 'Climatiseur de toiture', attributes: { marque: 'Daikin' } },
          { code: 'EQ-0003', label: 'Ascenseur n°1', attributes: { marque: 'Otis' } },
        ],
      },
      {
        code: 'B-PLT-B',
        label: 'Bâtiment B',
        children: [
          { code: 'EQ-0011', label: 'Surpresseur eau', attributes: { marque: 'Grundfos' } },
        ],
      },
    ],
  },
  {
    code: 'S-YOP',
    label: 'Zone industrielle de Yopougon',
    children: [
      {
        code: 'B-YOP-3',
        label: 'Entrepôt 3',
        children: [
          { code: 'EQ-0101', label: 'Transformateur HTA/BT', attributes: { marque: 'Schneider' } },
          { code: 'EQ-0102', label: "Compresseur d'air", attributes: { marque: 'Atlas Copco' } },
        ],
      },
    ],
  },
];

/**
 * Contenu de démonstration (P1.6) : référentiel Site > Bâtiment > Équipement et structure
 * « Inspection équipement » publiée. Idempotent : rien n'est recréé s'il existe déjà.
 */
export async function seedDemoContent(client: PrismaClient, instanceId: string) {
  return tenantTransaction(client, { instanceId }, async (tx) => {
    const name = 'Sites et équipements';
    const list =
      (await tx.list.findUnique({ where: { instanceId_name: { instanceId, name } } })) ??
      (await tx.list.create({
        data: { instanceId, name, levels: ['Site', 'Bâtiment', 'Équipement'] },
      }));

    if ((await tx.listItem.count({ where: { listId: list.id } })) === 0) {
      const insert = async (items: DemoItem[], parentId: string | null, level: number) => {
        for (const [position, item] of items.entries()) {
          const created = await tx.listItem.create({
            data: {
              instanceId,
              listId: list.id,
              parentId,
              level,
              code: item.code,
              label: item.label,
              attributes: item.attributes ?? {},
              position,
            },
          });
          await insert(item.children ?? [], created.id, level + 1);
        }
      };
      await insert(SITES, null, 0);
    }

    const structureName = 'Inspection équipement';
    let structure = await tx.structure.findFirst({ where: { name: structureName } });
    if (!structure) {
      structure = await tx.structure.create({
        data: {
          instanceId,
          name: structureName,
          description: 'Inspection périodique d un équipement, avec constat, photos et pièces.',
        },
      });
      await tx.structureVersion.create({
        data: {
          instanceId,
          structureId: structure.id,
          version: 1,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          definition: inspectionEquipement({ listId: list.id }) as Prisma.InputJsonValue,
        },
      });
    }
    return { list, structure };
  });
}
