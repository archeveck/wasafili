import { Injectable } from '@nestjs/common';
import { type Actor } from '../auth/decorators';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubmissionsService } from '../submissions/submissions.service';

interface Position {
  user_id: string;
  source_id: string;
  structure_id: string;
  lat: number;
  lng: number;
  at: Date;
}

/**
 * Suivi des équipes terrain (P6.1.2) : dernière position connue de chaque membre, tirée de la
 * position de l'appareil à la saisie d'une fiche, ou du lieu d'une tâche qu'il a terminée.
 * Seules comptent les fiches que l'appelant peut lire (droits par structure, visibilité).
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly submissions: SubmissionsService,
  ) {}

  async positions(actor: Actor) {
    const structures = await this.prisma.db.structure.findMany({ select: { id: true } });
    const readable = (
      await Promise.all(structures.map(({ id }) => this.submissions.readCondition(id, actor)))
    ).filter((condition): condition is Prisma.Sql => condition !== null);

    const [fromSubmissions, fromTasks, members] = await Promise.all([
      readable.length === 0
        ? []
        : this.prisma.transaction(
            (tx) => tx.$queryRaw<Position[]>`
              SELECT DISTINCT ON (s.author_id) s.author_id AS user_id, s.id AS source_id,
                     s.structure_id, s.latitude AS lat, s.longitude AS lng, s.created_at AS at
              FROM submissions s
              WHERE s.deleted_at IS NULL AND s.author_id IS NOT NULL
                AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
                AND (${Prisma.join(readable, ' OR ')})
              ORDER BY s.author_id, s.created_at DESC`,
          ),
      // Les tâches des autres ne sont visibles qu'avec `task:manage` (P4.4).
      actor.permissions.has('task:manage')
        ? this.prisma.transaction(
            (tx) => tx.$queryRaw<Position[]>`
              SELECT DISTINCT ON (t.assignee_user_id) t.assignee_user_id AS user_id,
                     t.id AS source_id, t.structure_id, t.latitude AS lat, t.longitude AS lng,
                     t.updated_at AS at
              FROM tasks t
              WHERE t.deleted_at IS NULL AND t.status = 'done' AND t.assignee_user_id IS NOT NULL
                AND t.latitude IS NOT NULL AND t.longitude IS NOT NULL
              ORDER BY t.assignee_user_id, t.updated_at DESC`,
          )
        : [],
      this.prisma.db.membership.findMany({
        select: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      }),
    ]);

    const latest = new Map<string, Position & { source: 'submission' | 'task' }>();
    for (const [source, rows] of [
      ['submission', fromSubmissions],
      ['task', fromTasks],
    ] as const) {
      for (const row of rows) {
        const known = latest.get(row.user_id);
        if (!known || known.at < row.at) latest.set(row.user_id, { ...row, source });
      }
    }
    const data = members.flatMap(({ user }) => {
      const position = latest.get(user.id);
      return position
        ? [
            {
              user,
              lat: position.lat,
              lng: position.lng,
              at: position.at,
              source: position.source,
              sourceId: position.source_id,
              structureId: position.structure_id,
            },
          ]
        : [];
    });
    data.sort((a, b) => b.at.getTime() - a.at.getTime());
    return { data };
  }
}
