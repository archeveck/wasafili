import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Curseur de synchronisation (ADR 0007), par ressource paginée :
 * - `floor` : plancher de `sync_txid` (xmin du snapshot au début de la passe précédente) ;
 * - `start` + `pos` : passe en cours (xmin au début de la passe, dernière ligne renvoyée).
 * Toute ligne écrite par une transaction en cours au début d'une passe a un `sync_txid`
 * supérieur ou égal à `start` : elle est renvoyée à la passe suivante, jamais perdue.
 */
const resourceCursor = z.object({
  floor: z.string().regex(/^\d+$/),
  start: z.string().regex(/^\d+$/).optional(),
  pos: z.object({ txid: z.string().regex(/^\d+$/), id: z.uuid() }).optional(),
});

const cursorSchema = z.object({
  v: z.literal(1),
  structures: z.string().regex(/^\d+$/),
  items: resourceCursor,
  submissions: resourceCursor,
  // Ressources ajoutées en Phase 4 : un curseur plus ancien les reprend depuis le début.
  tasks: resourceCursor.default({ floor: '0' }),
  notifications: resourceCursor.default({ floor: '0' }),
  /**
   * Empreinte des droits de lecture au moment du curseur. Différente (ou absente) : les droits
   * ont pu se restreindre, le pull repart de zéro et le client efface ses copies serveur.
   */
  rights: z.string().optional(),
});

export type ResourceCursor = z.infer<typeof resourceCursor>;
export type SyncCursor = z.infer<typeof cursorSchema>;

export const INITIAL_CURSOR: SyncCursor = {
  v: 1,
  structures: '0',
  items: { floor: '0' },
  submissions: { floor: '0' },
  tasks: { floor: '0' },
  notifications: { floor: '0' },
};

export function encodeCursor(cursor: SyncCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(raw: string | undefined): SyncCursor {
  if (!raw) return INITIAL_CURSOR;
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
  } catch {
    throw new BadRequestException({
      error: 'invalid_cursor',
      message: 'Curseur de synchronisation invalide : resynchronisation complète requise',
    });
  }
}

/** Curseur suivant d'une ressource après une page. */
export function nextCursor(
  cursor: ResourceCursor,
  start: string,
  last: { txid: string; id: string } | undefined,
  hasMore: boolean,
): ResourceCursor {
  return hasMore && last ? { floor: cursor.floor, start, pos: last } : { floor: start };
}
