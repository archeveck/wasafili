import { useQuery } from '@tanstack/react-query';
import { type AuditEntry } from '@tesserax/sdk';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorMessage,
  Loading,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui/display';
import { FormRow, Input, Select } from '@/components/ui/form-controls';
import { fromZoned } from '@/lib/dates';
import { useApp } from '@/lib/use-app';
import { formatDateTime } from '@/lib/utils';

/** Familles d'actions proposées au filtre (préfixe `famille.`). */
const FAMILIES: [string, string][] = [
  ['auth.', 'Connexions et clés API'],
  ['user.', 'Membres'],
  ['role.', 'Rôles'],
  ['group.', 'Groupes'],
  ['structure.', 'Formulaires et droits'],
  ['list.', 'Référentiels'],
  ['report.', 'Rapports'],
  ['automation', 'Automatisations'],
  ['webhook', 'Webhooks'],
  ['dashboard.', 'Tableaux de bord'],
  ['submission.', 'Exports'],
  ['settings.', 'Paramètres'],
];

/** Paramètres journalisés, en une ligne lisible (le détail complet reste en infobulle). */
function summary(metadata: Record<string, unknown>): string {
  const parts = Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key} : ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  const text = parts.join(' · ');
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

/**
 * Journal d'audit (P6.3.2) : connexions, administration, droits, exports et clés API.
 * Les entrées sont immuables ; filtres par famille d'action, membre, objet et période.
 */
export function AuditPage() {
  const { t } = useTranslation();
  const { api, short, timeZone } = useApp();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const members = useQuery({
    queryKey: [short, 'users', 'all'],
    queryFn: () => api.users.list({ perPage: 100 }),
  });
  const query = {
    page,
    perPage: 50,
    ...(action ? { action } : {}),
    ...(actorId ? { actorId } : {}),
    ...(targetId.trim() ? { targetId: targetId.trim() } : {}),
    ...(from ? { from: fromZoned(from, '00:00', timeZone).toISOString() } : {}),
    // Borne de fin incluse : jusqu'au lendemain 00:00.
    ...(to
      ? { to: new Date(fromZoned(to, '00:00', timeZone).getTime() + 86_400_000).toISOString() }
      : {}),
  };
  const entries = useQuery({
    queryKey: [short, 'audit', query],
    queryFn: () => api.audit.list(query),
    placeholderData: (previous) => previous,
  });
  const update =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };
  const label = (entry: AuditEntry) => {
    const key = `audit.actions.${entry.action}`;
    const text = t(key);
    return text === key ? entry.action : text;
  };
  const meta = entries.data?.meta;

  return (
    <>
      <PageHeader
        title="Journal d’audit"
        description={
          meta ? `${meta.total} entrée(s)` : 'Connexions, administration, droits et exports'
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <FormRow label="Action" htmlFor="audit-action">
          <Select
            id="audit-action"
            value={action}
            onChange={(e) => update(setAction)(e.target.value)}
          >
            <option value="">Toutes</option>
            {FAMILIES.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </Select>
        </FormRow>
        <FormRow label="Membre" htmlFor="audit-actor">
          <Select
            id="audit-actor"
            value={actorId}
            onChange={(e) => update(setActorId)(e.target.value)}
          >
            <option value="">Tous</option>
            {(members.data?.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.firstName} {m.lastName}
              </option>
            ))}
          </Select>
        </FormRow>
        <FormRow label="Identifiant de l’objet" htmlFor="audit-target">
          <Input
            id="audit-target"
            value={targetId}
            placeholder="UUID"
            onChange={(e) => update(setTargetId)(e.target.value)}
          />
        </FormRow>
        <FormRow label="Du" htmlFor="audit-from">
          <Input
            id="audit-from"
            type="date"
            value={from}
            onChange={(e) => update(setFrom)(e.target.value)}
          />
        </FormRow>
        <FormRow label="Au" htmlFor="audit-to">
          <Input
            id="audit-to"
            type="date"
            value={to}
            onChange={(e) => update(setTo)(e.target.value)}
          />
        </FormRow>
      </div>
      {entries.error && <ErrorMessage error={entries.error} />}
      {entries.isPending && <Loading />}
      {entries.data?.data.length === 0 && <EmptyState title="Aucune entrée pour ces filtres" />}
      {!!entries.data?.data.length && (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Action</Th>
                <Th>Par</Th>
                <Th>Objet</Th>
                <Th>Détails</Th>
                <Th>Adresse IP</Th>
              </tr>
            </thead>
            <tbody>
              {entries.data.data.map((entry) => (
                <tr key={entry.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(entry.createdAt, timeZone)}</Td>
                  <Td>
                    <span
                      className={
                        entry.action.endsWith('_failed') ? 'font-medium text-danger' : undefined
                      }
                    >
                      {label(entry)}
                    </span>
                  </Td>
                  <Td>{entry.actorLabel ?? '—'}</Td>
                  <Td>
                    {entry.targetLabel ?? (entry.targetId ? <code>{entry.targetId}</code> : '—')}
                  </Td>
                  <Td
                    className="max-w-md text-xs text-muted"
                    title={JSON.stringify(entry.metadata, null, 2)}
                  >
                    {summary(entry.metadata)}
                  </Td>
                  <Td className="text-xs text-muted">{entry.ip ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {meta && meta.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-end gap-2 text-sm">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Précédent
              </Button>
              <span>
                Page {meta.page} / {meta.totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= meta.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Suivant
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
