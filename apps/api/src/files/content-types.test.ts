import { describe, expect, it } from 'vitest';
import { isBlockedType, isInlineType, matchesSignature } from './content-types';

const PNG = Buffer.from('89504e470d0a1a0a0000000d', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a4649460001', 'hex');

describe('types de fichiers', () => {
  it('refuse les contenus actifs et exécutables', () => {
    expect(isBlockedType('text/html')).toBe(true);
    expect(isBlockedType('Image/SVG+XML')).toBe(true);
    expect(isBlockedType('image/jpeg')).toBe(false);
    expect(
      isBlockedType('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe(false);
  });

  it('vérifie la signature des types affichés dans le navigateur', () => {
    expect(matchesSignature('image/png', PNG)).toBe(true);
    expect(matchesSignature('image/jpeg', JPEG)).toBe(true);
    expect(matchesSignature('image/png', JPEG)).toBe(false);
    expect(matchesSignature('application/pdf', Buffer.from('%PDF-1.7\n'))).toBe(true);
    expect(matchesSignature('application/pdf', Buffer.from('<html><script>'))).toBe(false);
    expect(matchesSignature('image/webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe(true);
    // Sans signature connue : servi en téléchargement, pas vérifié.
    expect(matchesSignature('text/csv', Buffer.from('a;b\n'))).toBe(true);
  });

  it('n’affiche dans le navigateur que les images et les PDF vérifiés', () => {
    expect(isInlineType('image/jpeg')).toBe(true);
    expect(isInlineType('application/pdf')).toBe(true);
    expect(isInlineType('text/plain')).toBe(false);
    expect(isInlineType('image/bmp')).toBe(false);
  });
});
