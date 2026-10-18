/** File unique ; les jobs se distinguent par leur nom. Files dédiées si besoin (Phase 5). */
export const QUEUE_NAME = 'tesserax';

/** Miniature d'une image téléversée (P2.8). */
export interface ThumbnailJob {
  instanceId: string;
  fileId: string;
  /** Clé de l'objet source dans le bucket. */
  key: string;
  /** Clé de la miniature à écrire. */
  thumbnailKey: string;
}

export interface JobPayloads {
  thumbnail: ThumbnailJob;
}

export type JobName = keyof JobPayloads;

/** Largeur/hauteur maximale des miniatures, en pixels. */
export const THUMBNAIL_SIZE = 320;
