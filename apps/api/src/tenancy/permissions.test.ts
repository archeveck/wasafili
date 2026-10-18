import { describe, expect, it } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES } from './permissions';

describe('rôles système', () => {
  it('admin possède toutes les permissions', () => {
    expect(new Set(SYSTEM_ROLES.admin.permissions)).toEqual(new Set(PERMISSIONS));
  });

  it('les rôles sont strictement emboîtés : technicien ⊂ superviseur ⊂ admin', () => {
    const superviseur = new Set(SYSTEM_ROLES.superviseur.permissions);
    const technicien = SYSTEM_ROLES.technicien.permissions.filter(
      (permission) => permission !== 'submission:read:own',
    );
    expect(technicien.every((permission) => superviseur.has(permission))).toBe(true);
    expect(superviseur.size).toBeLessThan(PERMISSIONS.length);
  });

  it('aucun rôle non admin ne gère les rôles, les clés API ou l instance', () => {
    for (const role of [SYSTEM_ROLES.superviseur, SYSTEM_ROLES.technicien]) {
      expect(role.permissions).not.toContain('role:manage');
      expect(role.permissions).not.toContain('apikey:manage');
      expect(role.permissions).not.toContain('instance:manage');
    }
  });
});
