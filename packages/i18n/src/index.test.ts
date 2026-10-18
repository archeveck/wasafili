import { describe, expect, it } from 'vitest';
import { resources } from './index.js';

function keys(tree: object, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keys(v as object, `${prefix}${k}.`),
  );
}

describe('i18n', () => {
  it('en a exactement les mêmes clés que fr', () => {
    expect(keys(resources.en.translation).sort()).toEqual(keys(resources.fr.translation).sort());
  });
});
