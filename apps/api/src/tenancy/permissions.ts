/**
 * Catalogue des permissions d'instance. Les droits fins par structure (lire toutes / ses
 * fiches, filtres de visibilité) s'ajoutent en Phase 2 (P2.6).
 */
export const PERMISSIONS = [
  'instance:manage',
  'user:read',
  'user:manage',
  'role:read',
  'role:manage',
  'group:read',
  'group:manage',
  'structure:read',
  'structure:create',
  'structure:update',
  'structure:publish',
  'structure:delete',
  'list:read',
  'list:manage',
  'submission:create',
  'submission:read:own',
  'submission:read:all',
  'submission:update',
  'submission:delete',
  'submission:export',
  'task:read',
  'task:manage',
  'report:manage',
  'automation:manage',
  'apikey:manage',
  'audit:read',
  'dashboard:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type SystemRoleKey = 'admin' | 'superviseur' | 'technicien';

/** Rôles créés avec chaque instance (modifiables ensuite, sauf `admin`). */
export const SYSTEM_ROLES: Record<SystemRoleKey, { name: string; permissions: Permission[] }> = {
  admin: { name: 'Administrateur', permissions: [...PERMISSIONS] },
  superviseur: {
    name: 'Superviseur',
    permissions: [
      'user:read',
      'role:read',
      'group:read',
      'group:manage',
      'structure:read',
      'list:read',
      'list:manage',
      'submission:create',
      'submission:read:all',
      'submission:update',
      'submission:delete',
      'submission:export',
      'task:read',
      'task:manage',
      'dashboard:manage',
    ],
  },
  technicien: {
    name: 'Technicien',
    permissions: [
      'structure:read',
      'list:read',
      'submission:create',
      'submission:read:own',
      'submission:update',
      'task:read',
    ],
  },
};
