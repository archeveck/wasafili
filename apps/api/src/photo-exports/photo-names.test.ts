import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PATTERN,
  extensionOf,
  patternErrors,
  renderPattern,
  safeSegment,
  uniquePaths,
} from './photo-names';

const values = {
  structure: 'Inspection équipement',
  fiche: '3f2a9c1e',
  id: '3f2a9c1e-0000-4000-8000-000000000000',
  date: '2026-10-18',
  etat: 'valide',
  auteur: 'technicien',
  champ: 'photos',
  libelle: 'Photos',
  n: '1',
  original: 'IMG_0001',
  values: { numero: 'SN/42', mesure: 12, vide: null },
};

describe('modèle de nommage', () => {
  it('valide les jetons', () => {
    expect(patternErrors(DEFAULT_PATTERN)).toEqual([]);
    expect(patternErrors('{valeur:numero}_{n}')).toEqual([]);
    expect(patternErrors('{inconnu}_{n}')).toEqual(['Jeton inconnu : {inconnu}']);
    expect(patternErrors('{n:x}')).toEqual(['Jeton inconnu : {n:x}']);
    expect(patternErrors('{valeur}')).toEqual(['{valeur:cle} attend la clé d’un champ']);
    expect(patternErrors('photo_{n')).toEqual(['Accolade sans jeton']);
    expect(patternErrors('  ')).toEqual(['Modèle vide']);
  });

  it('produit des chemins sûrs, dossiers compris', () => {
    expect(renderPattern(DEFAULT_PATTERN, values)).toBe('2026-10-18_3f2a9c1e/photos_1');
    expect(renderPattern('{structure}/{valeur:numero}-{valeur:mesure}{valeur:vide}', values)).toBe(
      'Inspection équipement/SN_42-12',
    );
    expect(renderPattern('../{n}/', values)).toBe('_/1/_');
  });

  it('neutralise les segments dangereux', () => {
    expect(safeSegment('..')).toBe('_');
    expect(safeSegment('a\\b:c*?"<>|\u0001')).toBe('a_b_c_______');
    expect(safeSegment('')).toBe('_');
    expect(safeSegment('x'.repeat(150))).toHaveLength(100);
  });

  it('dédoublonne sans tenir compte de la casse', () => {
    const unique = uniquePaths();
    expect(unique('a/photo', 'jpg')).toBe('a/photo.jpg');
    expect(unique('a/PHOTO', 'jpg')).toBe('a/PHOTO-2.jpg');
    expect(unique('a/photo', 'jpg')).toBe('a/photo-3.jpg');
    expect(unique('b', '')).toBe('b');
  });

  it('déduit l extension', () => {
    expect(extensionOf('image/jpeg', 'x.png')).toBe('jpg');
    expect(extensionOf('application/octet-stream', 'scan.TIFF')).toBe('tiff');
    expect(extensionOf('application/octet-stream', 'sans-extension')).toBe('');
  });
});
