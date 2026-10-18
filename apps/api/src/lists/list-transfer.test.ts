import { describe, expect, it } from 'vitest';
import { defaultMapping, exportTable, type ExistingItem, planImport } from './list-transfer';
import { readSpreadsheet, writeSpreadsheet } from './spreadsheet';

const levels = ['Site', 'Bâtiment', 'Équipement'];
const headers = [
  'Site code',
  'Site',
  'Bâtiment',
  'Équipement code',
  'Équipement',
  'Équipement.marque',
];
const rows = [
  {
    'Site code': 'S1',
    Site: 'Plateau',
    Bâtiment: 'Tour A',
    'Équipement code': 'EQ1',
    Équipement: 'Groupe',
    'Équipement.marque': 'SDMO',
  },
  {
    'Site code': 'S1',
    Site: 'Plateau',
    Bâtiment: 'Tour A',
    'Équipement code': 'EQ2',
    Équipement: 'Clim',
    'Équipement.marque': '',
  },
  {
    'Site code': 'S2',
    Site: 'Yopougon',
    Bâtiment: '',
    'Équipement code': '',
    Équipement: '',
    'Équipement.marque': '',
  },
];

let counter = 0;
const newId = () => `new-${++counter}`;
const plan = (overrides: Partial<Parameters<typeof planImport>[0]> = {}) => {
  counter = 0;
  return planImport({ levels, headers, rows, existing: [], mode: 'merge', newId, ...overrides });
};

describe('defaultMapping', () => {
  it('reconnaît libellé, code et attributs par niveau, sans tenir compte de la casse', () => {
    expect(defaultMapping(levels, headers)).toEqual([
      { label: 'Site', code: 'Site code' },
      { label: 'Bâtiment' },
      { label: 'Équipement', code: 'Équipement code', attributes: { marque: 'Équipement.marque' } },
    ]);
    expect(defaultMapping(levels, ['site', 'autre'])).toEqual([{ label: 'site' }]);
  });
});

describe('planImport', () => {
  it('crée l arborescence en dédoublonnant les parents', () => {
    const result = plan();
    expect(result.errors).toEqual([]);
    expect(
      result.creates.map((item) => [item.id, item.parentId, item.level, item.code, item.label]),
    ).toEqual([
      ['new-1', null, 0, 'S1', 'Plateau'],
      ['new-2', 'new-1', 1, null, 'Tour A'],
      ['new-3', 'new-2', 2, 'EQ1', 'Groupe'],
      ['new-4', 'new-2', 2, 'EQ2', 'Clim'],
      ['new-5', null, 0, 'S2', 'Yopougon'],
    ]);
    expect(result.creates[2]!.attributes).toEqual({ marque: 'SDMO' });
    expect(result.creates[3]!.attributes).toEqual({});
  });

  it('met à jour les éléments existants et compte les inchangés (fusion)', () => {
    const existing: ExistingItem[] = [
      {
        id: 's1',
        parentId: null,
        level: 0,
        code: 'S1',
        label: 'Plateau',
        attributes: {},
        archived: false,
        position: 0,
      },
      {
        id: 'b1',
        parentId: 's1',
        level: 1,
        code: null,
        label: 'tour a',
        attributes: {},
        archived: false,
        position: 1,
      },
      {
        id: 'e1',
        parentId: 'b1',
        level: 2,
        code: 'EQ1',
        label: 'Ancien',
        attributes: { marque: 'X', serie: '1' },
        archived: true,
        position: 2,
      },
      {
        id: 'old',
        parentId: null,
        level: 0,
        code: 'S9',
        label: 'Fermé',
        attributes: {},
        archived: false,
        position: 3,
      },
    ];
    const result = plan({ existing });
    expect(result.errors).toEqual([]);
    expect(result.updates).toEqual([
      { id: 'b1', label: 'Tour A' },
      { id: 'e1', label: 'Groupe', attributes: { marque: 'SDMO', serie: '1' }, unarchive: true },
    ]);
    expect(result.unchanged).toBe(1);
    expect(result.creates.map((item) => item.code)).toEqual(['EQ2', 'S2']);
    expect(result.creates[0]!.position).toBe(4);
    expect(result.archives).toEqual([]);
    expect(plan({ existing, mode: 'replace' }).archives).toEqual(['old']);
  });

  it('ajoute un code à un élément existant reconnu par son libellé', () => {
    const existing: ExistingItem[] = [
      {
        id: 's2',
        parentId: null,
        level: 0,
        code: null,
        label: 'Yopougon',
        attributes: {},
        archived: false,
        position: 0,
      },
    ];
    expect(plan({ existing, rows: [rows[2]!] }).updates).toEqual([{ id: 's2', code: 'S2' }]);
  });

  it('signale les lignes invalides avec leur numéro', () => {
    const result = plan({
      rows: [
        rows[0]!,
        { ...rows[0]!, 'Site code': '', Site: '', Bâtiment: 'Orphelin' },
        { ...rows[0]!, 'Équipement code': 'EQ1', Équipement: 'Autre nom' },
        { ...rows[0]!, 'Site code': 'S3', Site: 'Ailleurs' },
        { ...rows[0]!, Site: '', 'Site code': 'S1' },
        { ...rows[0]!, Site: '', 'Site code': '', Bâtiment: '', 'Équipement code': 'EQ9' },
      ],
    });
    expect(result.errors).toEqual([
      { row: 3, message: 'Site : libellé manquant' },
      { row: 4, message: 'Équipement « EQ1 » : libellé différent de la ligne 2' },
      {
        row: 5,
        message:
          'Équipement « EQ1 » : déjà rattaché à un autre parent (déplacement non pris en charge)',
      },
      { row: 6, message: 'Site : libellé manquant' },
      { row: 7, message: 'Site : libellé manquant' },
    ]);
  });

  it('vérifie les colonnes et le nombre de niveaux', () => {
    expect(plan({ headers: ['Autre'] }).errors).toEqual([
      { row: 0, message: 'Colonne « Site » introuvable' },
    ]);
    expect(plan({ mapping: [{ label: 'Absente' }] }).errors).toEqual([
      { row: 0, message: 'Colonne « Absente » introuvable' },
    ]);
    expect(
      plan({
        mapping: [{ label: 'Site' }, { label: 'Site' }, { label: 'Site' }, { label: 'Site' }],
      }).errors,
    ).toEqual([{ row: 0, message: "Le référentiel n'a que 3 niveau(x)" }]);
  });
});

describe('export et aller-retour', () => {
  const existing: ExistingItem[] = plan().creates.map((item) => ({ ...item, archived: false }));
  existing.push({
    id: 'arch',
    parentId: null,
    level: 0,
    code: 'Z',
    label: 'Archivé',
    attributes: {},
    archived: true,
    position: 9,
  });

  it('produit une ligne par chemin jusqu à une feuille active', () => {
    const table = exportTable(levels, existing);
    expect(table.headers).toEqual([
      'Site code',
      'Site',
      'Bâtiment code',
      'Bâtiment',
      'Équipement code',
      'Équipement',
      'Équipement.marque',
    ]);
    expect(
      table.rows.map((row) => [row['Site'], row['Bâtiment'] ?? '', row['Équipement'] ?? '']),
    ).toEqual([
      ['Plateau', 'Tour A', 'Groupe'],
      ['Plateau', 'Tour A', 'Clim'],
      ['Yopougon', '', ''],
    ]);
  });

  it.each(['csv', 'xlsx'] as const)('réimporte sans changement un export %s', async (format) => {
    const file = await writeSpreadsheet(format, exportTable(levels, existing));
    const table = await readSpreadsheet(file);
    const result = planImport({ levels, ...table, existing, mode: 'replace', newId });
    expect(result).toEqual({ creates: [], updates: [], archives: [], unchanged: 5, errors: [] });
  });

  it('lit un CSV séparé par des virgules, avec BOM', async () => {
    const table = await readSpreadsheet(
      Buffer.from('\uFEFFSite,Site code\n"Plateau, Abidjan",S1\n,\n'),
    );
    expect(table).toEqual({
      headers: ['Site', 'Site code'],
      rows: [{ Site: 'Plateau, Abidjan', 'Site code': 'S1' }],
    });
  });
});
