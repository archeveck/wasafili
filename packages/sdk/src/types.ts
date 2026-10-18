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
  /** Automatisation à l'origine de l'écriture (P5.3). */
  automation: { id: string; name: string } | null;
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

// --- Rapports (P5.1) ---

export interface ReportTag {
  name: string;
  kind: 'value' | 'loop' | 'image';
  parent?: string;
}

export interface ReportTemplate {
  id: string;
  structureId: string;
  name: string;
  fileId: string;
  fileName: string | null;
  /** Nom du PDF (balises admises) ; absent = nom du modèle. */
  filename: string | null;
  tags: ReportTag[];
  /** Balises qui ne correspondent pas à la version publiée du formulaire. */
  issues: { tag: string; message: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface ReportTags {
  fields: { tag: string; label: string; table?: string }[];
  builtins: { tag: string; label: string }[];
}

export interface RenderedReport {
  url: string;
  filename: string;
  cached: boolean;
}

// --- E-mails (P5.2) ---

export interface EmailMessage {
  id: string;
  to: string[];
  subject: string;
  status: 'queued' | 'sent' | 'failed';
  error: string | null;
  attempts: number;
  attachments: string[];
  automationRunId: string | null;
  sentAt: string | null;
  createdAt: string;
}

// --- Webhooks (P5.4) ---

export type WebhookEvent =
  'submission.created' | 'submission.updated' | 'submission.state_changed' | 'submission.deleted';

export interface Webhook {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  structureId: string | null;
  enabled: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  consecutiveFailures: number;
  /** Fin du secret ; le secret complet n'est renvoyé qu'à la création et à la rotation. */
  secretHint: string;
  secret?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookInput {
  name: string;
  url: string;
  events: WebhookEvent[];
  structureId?: string | null;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  status: 'pending' | 'delivered' | 'failed' | 'cancelled';
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
  automationRunId: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

// --- Automatisations (P5.3) ---

export type AutomationTrigger =
  | { type: 'submission_created' }
  | { type: 'state_changed'; to: string[] }
  | { type: 'field_changed'; fields: string[] }
  | { type: 'schedule'; cron: string };

export type Recipient =
  | { type: 'address'; email: string }
  | { type: 'author' }
  | { type: 'field'; field: string }
  | { type: 'user'; userId: string }
  | { type: 'group'; groupId: string };

export type TaskAssignee =
  | { type: 'none' }
  | { type: 'author' }
  | { type: 'user'; userId: string }
  | { type: 'group'; groupId: string };

export type AutomationAction =
  | { type: 'email'; to: Recipient[]; subject: string; body: string; reportId?: string }
  | { type: 'notify'; to: Recipient[]; title: string; body?: string }
  | {
      type: 'create_task';
      title: string;
      description?: string;
      structureId?: string;
      assignee: TaskAssignee;
      startInDays: number;
      startTime: string;
      durationMinutes: number;
      copyFields: boolean;
    }
  | { type: 'webhook'; webhookId: string }
  | { type: 'update_field'; field: string; value: unknown };

export interface AutomationInput {
  name: string;
  enabled: boolean;
  structureId: string | null;
  trigger: AutomationTrigger;
  conditions: Record<string, unknown> | null;
  actions: AutomationAction[];
}

export interface Automation extends AutomationInput {
  id: string;
  lastRun?: { status: AutomationRunStatus; createdAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

export type AutomationRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface AutomationStep {
  type: AutomationAction['type'];
  status: 'done' | 'failed';
  startedAt: string;
  durationMs: number;
  error?: string;
  result?: Record<string, unknown>;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  automationName: string;
  submissionId: string | null;
  event: {
    type: string;
    revision?: number;
    from?: string | null;
    to?: string | null;
    fields?: string[];
    at?: string;
  };
  depth: number;
  status: AutomationRunStatus;
  steps: AutomationStep[];
  error: string | null;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
}
