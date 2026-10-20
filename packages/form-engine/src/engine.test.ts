import { inspectionEquipement } from '@wasafili/form-schema';
import { describe, expect, it } from 'vitest';
import { createFormEngine, FormEngine } from './engine.js';
import { definition, field } from './test-utils.js';

const NOW = '2026-10-18T09:15:00Z';
const ctx = { now: NOW, user: { id: 'u1', roles: ['technicien'] } };

describe('calculs', () => {
  const engine = createFormEngine(inspectionEquipement({ listId: 'l' }));

  it('calcule par ligne puis agrège (structure de démonstration)', () => {
    const values = engine.calculate(
      {
        etat: 'degrade',
        pieces: [
          { _id: 'a', reference: 'R1', quantite: 2, prix_unitaire: 1500 },
          { _id: 'b', reference: 'R2', quantite: 1, prix_unitaire: 999.6 },
        ],
      },
      ctx,
    );
    expect(values['pieces']).toEqual([
      { _id: 'a', reference: 'R1', quantite: 2, prix_unitaire: 1500, montant: 3000 },
      { _id: 'b', reference: 'R2', quantite: 1, prix_unitaire: 999.6, montant: 1000 },
    ]);
    expect(values['total_pieces']).toBe(4000);
  });

  it('donne null quand une entrée manque, et 0 pour un agrégat vide', () => {
    const values = engine.calculate({ pieces: [{ _id: 'a', quantite: 2 }] }, ctx);
    expect((values['pieces'] as { montant: unknown }[])[0]!.montant).toBeNull();
    expect(values['total_pieces']).toBe(0);
    expect(engine.calculate({}, ctx)['total_pieces']).toBe(0);
  });

  it('ignore les lignes mal formées sans les modifier', () => {
    const values = engine.calculate({
      pieces: ['texte', { _id: 'a', quantite: 1, prix_unitaire: 5 }],
    });
    expect(values['pieces']).toEqual([
      'texte',
      { _id: 'a', quantite: 1, prix_unitaire: 5, montant: 5 },
    ]);
    expect(values['total_pieces']).toBe(5);
  });

  it('ne lit pas les variables d environnement comme des valeurs', () => {
    expect(Object.keys(engine.calculate({}, ctx)).some((key) => key.startsWith('$'))).toBe(false);
  });

  it('enchaîne les calculs en ordre de dépendance, quelle que soit leur position', () => {
    const chained = createFormEngine(
      definition([
        field('calculated', 'ttc', { formula: '{ht} * 1.18', resultType: 'number', decimals: 0 }),
        field('calculated', 'ht', { formula: '{prix} * {qte}', resultType: 'number' }),
        field('number', 'prix'),
        field('number', 'qte'),
      ]),
    );
    expect(chained.calculate({ prix: 1000, qte: 3 })).toMatchObject({ ht: 3000, ttc: 3540 });
  });

  it('convertit le résultat selon le type attendu', () => {
    const typed = createFormEngine(
      definition([
        field('text', 'a'),
        field('multiselect', 'm', { options: [{ value: 'x', label: 'X' }] }),
        field('calculated', 'texte', { formula: 'CONCAT("n°"; {a})', resultType: 'text' }),
        field('calculated', 'liste', { formula: '{m}', resultType: 'text' }),
        field('calculated', 'nombre', { formula: '{a}', resultType: 'number' }),
        field('calculated', 'brut', { formula: '{a}', resultType: 'number' }),
        field('calculated', 'vrai', { formula: '{a} = "12"', resultType: 'boolean' }),
        field('calculated', 'vide', { formula: 'SI(FAUX; VRAI)', resultType: 'boolean' }),
        field('calculated', 'jour', {
          formula: 'AJOUTER_JOURS(AUJOURDHUI(); 7)',
          resultType: 'date',
        }),
        field('calculated', 'pas_jour', { formula: '{a}', resultType: 'date' }),
        field('calculated', 'instant', { formula: 'MAINTENANT()', resultType: 'date' }),
      ]),
    );
    const values = typed.calculate({ a: '12', m: ['x', 'y'] }, ctx);
    expect(values).toMatchObject({
      texte: 'n°12',
      liste: 'x, y',
      nombre: 12,
      vrai: true,
      vide: null,
      jour: '2026-10-25',
      pas_jour: null,
      instant: '2026-10-18',
    });
    expect(typed.calculate({ a: 'abc' })['nombre']).toBeNull();
  });

  it('donne null pour une formule invalide ou un cycle', () => {
    const broken = createFormEngine(
      definition([
        field('calculated', 'a', { formula: '{b} + 1', resultType: 'number' }),
        field('calculated', 'b', { formula: '{a} + 1', resultType: 'number' }),
        field('calculated', 'c', { formula: '1 +', resultType: 'number' }),
        field('calculated', 'd', { formula: '{a} + 1', resultType: 'number' }),
      ]),
    );
    expect(broken.calculate({ a: 5, b: 5, c: 5 })).toEqual({ a: null, b: null, c: null, d: null });
    expect(broken.model.calcs.find((n) => n.id === 'a')?.error?.code).toBe('cycle');
    expect(broken.model.calcs.find((n) => n.id === 'c')?.error?.code).toBe('formula');
  });

  it('donne null dans chaque ligne pour une formule de colonne invalide', () => {
    const broken = createFormEngine(
      definition([
        field('table', 't', {
          fields: [field('calculated', 'm', { formula: '{q} *', resultType: 'number' })],
        }),
      ]),
    );
    expect(broken.calculate({ t: [{ _id: 'a', m: 3 }] })['t']).toEqual([{ _id: 'a', m: null }]);
  });

  it('recalcule uniquement les champs dépendant des clés modifiées', () => {
    const incremental = createFormEngine(
      definition([
        field('number', 'x'),
        field('number', 'y'),
        field('calculated', 'fx', { formula: '{x} * 2', resultType: 'number' }),
        field('calculated', 'fy', { formula: '{y} * 2', resultType: 'number' }),
        field('calculated', 'g', { formula: '{fx} + 1', resultType: 'number' }),
        field('table', 'lignes', {
          fields: [
            field('number', 'q'),
            field('calculated', 'm', { formula: '{q} * {x}', resultType: 'number' }),
          ],
        }),
        field('calculated', 'total', { formula: 'SOMME({lignes.m})', resultType: 'number' }),
      ]),
    );
    const previous = incremental.calculate({ x: 1, y: 1, lignes: [{ _id: 'r', q: 3 }] });
    expect(previous).toMatchObject({ fx: 2, fy: 2, g: 3, total: 3 });

    // fy volontairement faussé : il ne doit pas être recalculé si seul x change.
    const next = incremental.calculate({ ...previous, x: 10, fy: 999 }, {}, { changed: ['x'] });
    expect(next).toMatchObject({ fx: 20, g: 21, fy: 999, total: 30 });

    const rows = incremental.calculate(
      {
        ...next,
        lignes: [
          { _id: 'r', q: 3 },
          { _id: 's', q: 1 },
        ],
      },
      {},
      { changed: ['lignes.q'] },
    );
    expect(rows['total']).toBe(40);
    expect(incremental.calculate({ ...next, total: 0 }, {}, { changed: [] })['total']).toBe(0);
  });
});

describe('visibilité, caractère requis, lecture seule', () => {
  const engine = createFormEngine(inspectionEquipement({ listId: 'l' }));

  it('affiche les champs conditionnels selon les valeurs', () => {
    const bon = engine.evaluate({ etat: 'bon' }, ctx);
    expect(bon.fields['description_defaut']!.visible).toBe(false);
    expect(bon.fields['photos']).toEqual({ visible: true, required: false, readOnly: false });

    const hs = engine.evaluate({ etat: 'hors_service' }, ctx);
    expect(hs.fields['description_defaut']).toEqual({
      visible: true,
      required: true,
      readOnly: false,
    });
    expect(hs.fields['photos']!.required).toBe(true);
    expect(hs.fields['total_pieces']).toEqual({ visible: true, required: false, readOnly: true });
    expect(hs.fields['inspecteur']!.readOnly).toBe(true);
  });

  it('évalue les colonnes ligne par ligne et propage l état du tableau', () => {
    const state = engine.evaluate({ etat: 'degrade', pieces: [{ _id: 'a' }, 'invalide'] }, ctx);
    expect(state.rows['pieces']).toHaveLength(2);
    expect(state.rows['pieces']![0]!['reference']).toEqual({
      visible: true,
      required: true,
      readOnly: false,
    });
    expect(state.rows['pieces']![1]!['montant']!.readOnly).toBe(true);

    const hidden = engine.evaluate({ etat: 'bon', pieces: [{ _id: 'a' }] }, ctx);
    expect(hidden.rows['pieces']![0]!['reference']).toEqual({
      visible: false,
      required: false,
      readOnly: false,
    });
    expect(engine.evaluate({ pieces: 'pas un tableau' }).rows['pieces']).toEqual([]);
  });

  it('masque les champs d une section masquée et les champs cachés', () => {
    const sectioned = createFormEngine(
      definition([
        field('boolean', 'avance'),
        field('section', 's', {
          visibleIf: { '==': [{ var: 'avance' }, true] },
          readOnly: true,
          fields: [field('text', 'detail', { required: true })],
        }),
        field('hidden', 'source', { defaultValue: 'mobile' }),
        field('info', 'aide', { content: 'Texte', required: true }),
      ]),
    );
    expect(sectioned.evaluate({}).fields['detail']).toEqual({
      visible: false,
      required: false,
      readOnly: true,
    });
    expect(sectioned.evaluate({ avance: true }).fields['detail']).toEqual({
      visible: true,
      required: true,
      readOnly: true,
    });
    expect(sectioned.evaluate({}).fields['source']!.visible).toBe(false);
    expect(sectioned.evaluate({}).fields['aide']).toEqual({
      visible: true,
      required: false,
      readOnly: false,
    });
  });

  it('applique les restrictions par état de workflow et par rôle', () => {
    const restricted = createFormEngine(
      definition([
        field('text', 'avis', {
          visibleInStates: ['soumis', 'valide'],
          editableInStates: ['soumis'],
          editableByRoles: ['superviseur'],
        }),
        field('text', 'note_interne', { visibleToRoles: ['admin'] }),
      ]),
    );
    const technicien = restricted.evaluate(
      {},
      { state: 'soumis', user: { id: 'u', roles: ['technicien'] } },
    );
    expect(technicien.fields['avis']).toEqual({ visible: true, required: false, readOnly: true });
    expect(technicien.fields['note_interne']!.visible).toBe(false);

    const superviseur = restricted.evaluate(
      {},
      { state: 'soumis', user: { id: 'u', roles: ['superviseur'] } },
    );
    expect(superviseur.fields['avis']!.readOnly).toBe(false);
    expect(restricted.evaluate({}, { state: 'valide' }).fields['avis']!.readOnly).toBe(true);
    expect(restricted.evaluate({}, { state: null }).fields['avis']!.visible).toBe(false);
    expect(
      restricted.evaluate({}, { user: { id: 'a', roles: ['admin'] } }).fields['note_interne']!
        .visible,
    ).toBe(true);
  });

  it('expose le contexte aux conditions ($state, $user, $row)', () => {
    const contextual = createFormEngine(
      definition([
        field('text', 'a', { visibleIf: { '==': [{ var: '$state' }, 'soumis'] } }),
        field('text', 'b', { requiredIf: { in: ['admin', { var: '$user.roles' }] } }),
        field('table', 't', {
          fields: [
            field('boolean', 'ko'),
            field('text', 'motif', { visibleIf: { '==': [{ var: '$row.ko' }, true] } }),
          ],
        }),
      ]),
    );
    const state = contextual.evaluate(
      {
        t: [
          { _id: '1', ko: true },
          { _id: '2', ko: false },
        ],
      },
      { state: 'soumis', user: { id: 'u', roles: ['admin'] } },
    );
    expect(state.fields['a']!.visible).toBe(true);
    expect(state.fields['b']!.required).toBe(true);
    expect(state.rows['t']!.map((row) => row['motif']!.visible)).toEqual([true, false]);
  });

  it('fournit un environnement par défaut sans contexte', () => {
    const env = new FormEngine(definition([])).environment();
    expect(env).toMatchObject({ $user: { id: null, roles: [] }, $state: null });
    expect(env['$today']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('valeurs par défaut et champs automatiques', () => {
  const engine = createFormEngine(
    definition([
      field('text', 'texte', { defaultValue: 'abc' }),
      field('number', 'nombre'),
      field('date', 'jour', { defaultNow: true }),
      field('date', 'jour_fixe', { defaultValue: '2026-01-01', defaultNow: true }),
      field('date', 'jour_libre'),
      field('time', 'heure', { defaultNow: true }),
      field('time', 'heure_libre'),
      field('datetime', 'instant', { defaultNow: true }),
      field('datetime', 'instant_libre'),
      field('multiselect', 'choix', { options: [{ value: 'a', label: 'A' }], defaultValue: ['a'] }),
      field('multiselect', 'choix_libre', { options: [{ value: 'a', label: 'A' }] }),
      field('timestamp', 'cree', { mode: 'created' }),
      field('timestamp', 'maj', { mode: 'updated' }),
      field('author', 'auteur'),
      field('section', 'sec', { fields: [field('boolean', 'ok', { defaultValue: false })] }),
      field('info', 'aide', { content: 'x' }),
      field('table', 'lignes', {
        fields: [
          field('number', 'q', { defaultValue: 1 }),
          field('author', 'par'),
          field('text', 'libre'),
        ],
      }),
    ]),
  );

  it('remplit les valeurs absentes à la création', () => {
    expect(engine.applyDefaults({ nombre: 5 }, { ...ctx, timeZone: 'Asia/Tokyo' })).toEqual({
      texte: 'abc',
      nombre: 5,
      jour: '2026-10-18',
      jour_fixe: '2026-01-01',
      heure: '18:15',
      instant: NOW.replace('Z', '.000Z'),
      choix: ['a'],
      cree: '2026-10-18T09:15:00.000Z',
      maj: '2026-10-18T09:15:00.000Z',
      auteur: 'u1',
      ok: false,
    });
  });

  it('ne remplace jamais une valeur existante, sauf l horodatage de modification', () => {
    const existing = {
      texte: 'saisi',
      cree: '2026-01-01T00:00:00.000Z',
      maj: 'ancien',
      auteur: 'u0',
    };
    expect(engine.applyDefaults(existing, ctx, { isNew: false })).toMatchObject({
      texte: 'saisi',
      cree: '2026-01-01T00:00:00.000Z',
      maj: '2026-10-18T09:15:00.000Z',
      auteur: 'u0',
    });
    const update = engine.applyDefaults({}, ctx, { isNew: false });
    expect(update['cree']).toBeUndefined();
    expect(update['auteur']).toBeUndefined();
  });

  it('crée une ligne de tableau avec ses défauts', () => {
    expect(engine.createRow('lignes', 'r1', ctx)).toEqual({ _id: 'r1', q: 1, par: 'u1' });
    expect(engine.createRow('lignes', 'r2')).toEqual({ _id: 'r2', q: 1 });
    expect(() => engine.createRow('texte', 'x')).toThrow('Tableau inconnu : texte');
  });

  it('utilise l horloge locale sans instant de référence', () => {
    const values = engine.applyDefaults({});
    expect(values['jour']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(values['heure']).toMatch(/^\d{2}:\d{2}$/);
  });
});
