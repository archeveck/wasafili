/** File des relais du worker ; les jobs se distinguent par leur nom. */
export const QUEUE_NAME = 'tesserax';

/**
 * File des exécutions d'automatisations, consommée par l'API : les actions (mise à jour de
 * champ, tâche, notification) passent par ses services métier (ADR 0009).
 */
export const AUTOMATION_QUEUE_NAME = 'tesserax-automations';

/**
 * Préfixe des clés Redis par défaut. Un environnement (tests, préproduction) qui partage un
 * Redis doit utiliser son propre préfixe (`QUEUE_PREFIX`) pour ne pas consommer les jobs des autres.
 */
export const DEFAULT_QUEUE_PREFIX = 'tesserax';

/** Miniature d'une image téléversée (P2.8). */
export interface ThumbnailJob {
  instanceId: string;
  fileId: string;
  /** Clé de l'objet source dans le bucket. */
  key: string;
  /** Clé de la miniature à écrire. */
  thumbnailKey: string;
}

/** Relais push (Expo) de notifications déjà enregistrées (P4.5, D1). */
export interface PushJob {
  instanceId: string;
  notificationIds: string[];
}

/** Envoi SMTP d'un e-mail du journal d'envoi (P5.2). */
export interface EmailJob {
  instanceId: string;
  emailId: string;
}

/** Livraison signée d'un événement à un webhook (P5.4). */
export interface WebhookJob {
  instanceId: string;
  deliveryId: string;
}

/** Archive ZIP des photos d'une sélection de fiches (P6.4) ; entrées lues sur l'export. */
export interface PhotoExportJob {
  instanceId: string;
  exportId: string;
}

/** Purge des archives expirées (tâche récurrente du worker). */
export type PhotoExportCleanupJob = Record<string, never>;

export interface JobPayloads {
  thumbnail: ThumbnailJob;
  push: PushJob;
  email: EmailJob;
  webhook: WebhookJob;
  'photos-zip': PhotoExportJob;
  'photo-exports-cleanup': PhotoExportCleanupJob;
}

/** Durée pendant laquelle une archive de photos reste téléchargeable. */
export const PHOTO_EXPORT_TTL_MS = 7 * 24 * 3600 * 1000;

/** Tentatives d'un e-mail (backoff exponentiel depuis 30 s : ≈ 15 min au total). */
export const EMAIL_ATTEMPTS = 5;
export const EMAIL_BACKOFF_MS = 30_000;
/** Tentatives d'une livraison de webhook (backoff exponentiel depuis 10 s : ≈ 40 min). */
export const WEBHOOK_ATTEMPTS = 8;
export const WEBHOOK_BACKOFF_MS = 10_000;

/** Exécution d'une automatisation déclenchée par un événement, ou tick d'un déclencheur planifié. */
export type AutomationJob =
  | { kind: 'run'; instanceId: string; runId: string }
  | { kind: 'schedule'; instanceId: string; automationId: string };

/**
 * Signature d'un webhook : `X-Tesserax-Signature: sha256=<hex>`, HMAC-SHA256 du secret sur
 * `<horodatage>.<corps>` (horodatage en secondes, `X-Tesserax-Timestamp`). Le destinataire
 * recalcule la signature et refuse un horodatage trop ancien (rejeu).
 */
export const WEBHOOK_SIGNATURE_HEADER = 'x-tesserax-signature';
export const WEBHOOK_TIMESTAMP_HEADER = 'x-tesserax-timestamp';

export type JobName = keyof JobPayloads;

/** Largeur/hauteur maximale des miniatures, en pixels. */
export const THUMBNAIL_SIZE = 320;
