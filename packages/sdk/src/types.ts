import { type StructureDefinition, type SubmissionData } from '@tesserax/form-schema';

/** Types des réponses de l'API `/v1` (amorce manuelle ; générés depuis l'OpenAPI en P7.1.3). */

export interface Page<T> {
  data: T[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
}

export interface Tokens {
  access_token: string;
  refresh_token?: string;
  token_type: 'Bearer';
  expires_in: number;
}

export interface Me {
  kind: 'user' | 'client';
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

/** Profil de l'appelant dans une instance : rôles et permissions. */
export interface MemberProfile extends Me {
  roles: string[];
  permissions: string[];
}

export interface InstanceSummary {
  id: string;
  short: string;
  name: string;
  timeZone: string;
  locale: string;
}

export interface Branding {
  logoFileId?: string | null;
  primaryColor?: string;
  accentColor?: string;
}

export interface MobileTile {
  id: string;
  label: string;
  icon: string;
  kind: 'structure' | 'tasks' | 'submissions' | 'scan' | 'map';
  structureId?: string;
  color?: string;
}

export interface Settings extends InstanceSummary {
  branding: Branding;
  mobileMenu: MobileTile[];
}

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
}

export interface Role extends RoleSummary {
  permissions: string[];
  isSystem: boolean;
}

export interface Member {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  role: RoleSummary;
  attributes: Record<string, string | number | boolean>;
  groups: { id: string; name: string }[];
  memberSince: string;
  temporaryPassword?: string;
}

export interface Group {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  _count: { members: number };
  members?: { id: string; email: string; firstName: string; lastName: string }[];
}

export type VersionStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface VersionSummary {
  id: string;
  version: number;
  status: VersionStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Structure {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  currentVersion: number | null;
  draftVersion: number | null;
  createdAt: string;
  updatedAt: string;
  versions?: VersionSummary[];
}

export interface StructureVersion extends VersionSummary {
  structureId: string;
  definition: StructureDefinition;
}

export interface Submission {
  id: string;
  structureId: string;
  structureVersionId: string;
  version: number;
  state: string | null;
  authorId: string | null;
  revision: number;
  data: SubmissionData;
  location: { lat: number; lng: number; accuracy: number | null } | null;
  createdAt: string;
  updatedAt: string;
}

export type { NotificationDto as Notification, TaskDto as Task, TaskStatus } from '@tesserax/sync';

export interface StateCount {
  state: string | null;
  count: number;
}

export interface Revision {
  id: string;
  revision: number;
  action: 'create' | 'update' | 'transition' | 'delete';
  authorId: string | null;
  clientMutationId: string | null;
  changes: { field: string; before: unknown; after: unknown }[];
  createdAt: string;
}

export type FilterOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';

export interface Filter {
  key: string;
  operator: FilterOperator;
  value: string;
}

export type StructurePermission =
  'create' | 'read:all' | 'read:own' | 'update' | 'delete' | 'export';

export interface AccessRule {
  id?: string;
  roleId?: string | null;
  groupId?: string | null;
  permissions: StructurePermission[];
  visibility?: Filter[] | null;
}

export interface List {
  id: string;
  name: string;
  description: string | null;
  levels: string[];
  itemCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListItem {
  id: string;
  listId: string;
  parentId: string | null;
  level: number;
  code: string | null;
  label: string;
  attributes: Record<string, string | number | boolean | null>;
  position: number;
  archivedAt: string | null;
}

export interface ImportReport {
  dryRun: boolean;
  applied: boolean;
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  archived: number;
  errors: { row: number; message: string }[];
  preview: { level: number; code: string | null; label: string }[];
}

export interface LevelMapping {
  label: string;
  code?: string;
  attributes?: Record<string, string>;
}

export interface FileDto {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: 'pending' | 'uploaded';
  createdAt: string;
  url: string | null;
  thumbnailUrl: string | null;
}

/** Conflit de modification sur un champ (dernière écriture gagnante, valeur écrasée conservée). */
export interface SubmissionConflict {
  id: string;
  submissionId: string;
  field: string;
  baseRevision: number;
  appliedRevision: number;
  appliedValue: { value: unknown };
  overwrittenValue: { value: unknown };
  clientMutationId: string | null;
  authorId: string | null;
  resolution: 'kept' | 'restored' | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  createdAt: string;
}
