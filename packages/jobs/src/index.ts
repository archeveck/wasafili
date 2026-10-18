/** File unique ; les jobs se distinguent par leur nom. Files dédiées si besoin (Phase 5). */
export const QUEUE_NAME = 'tesserax';

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

export interface JobPayloads {
  thumbnail: ThumbnailJob;
  push: PushJob;
}

export type JobName = keyof JobPayloads;

/** Largeur/hauteur maximale des miniatures, en pixels. */
export const THUMBNAIL_SIZE = 320;
