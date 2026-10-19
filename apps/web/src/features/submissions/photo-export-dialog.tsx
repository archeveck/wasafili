import { useMutation, useQuery } from '@tanstack/react-query';
import { type Filter, type PhotoExport } from '@tesserax/sdk';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorMessage, Spinner } from '@/components/ui/display';
import { FormRow, Input } from '@/components/ui/form-controls';
import { Dialog } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { useApp } from '@/lib/use-app';
import { formatDateTime } from '@/lib/utils';

const DEFAULT_PATTERN = '{date}_{fiche}/{champ}_{n}';
const TOKENS: [string, string][] = [
  ['{date}', 'date de création de la fiche'],
  ['{fiche}', 'identifiant court de la fiche'],
  ['{etat}', 'état de workflow'],
  ['{auteur}', 'auteur'],
  ['{champ}', 'clé du champ photo'],
  ['{libelle}', 'libellé du champ'],
  ['{n}', 'numéro de la photo dans le champ'],
  ['{original}', 'nom du fichier d’origine'],
  ['{valeur:cle}', 'valeur d’un champ de la fiche'],
];

const formatSize = (bytes: number | null) =>
  bytes === null
    ? ''
    : bytes > 1_048_576
      ? `${(bytes / 1_048_576).toFixed(1)} Mo`
      : `${Math.ceil(bytes / 1024)} Ko`;

/**
 * Export ZIP des photos (P6.4) de la sélection du tableau. L'archive est préparée par le
 * worker ; le lien de téléchargement, signé, n'est valable que quelques minutes.
 */
export function PhotoExportDialog({
  open,
  onOpenChange,
  structureId,
  filters,
  state,
  sort,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  structureId: string;
  filters: Filter[];
  state: string | undefined;
  sort: string | undefined;
}) {
  const { api, short, timeZone } = useApp();
  const toast = useToast();
  const [pattern, setPattern] = useState(DEFAULT_PATTERN);
  const [exportId, setExportId] = useState<string>();
  const [missing, setMissing] = useState(0);

  const start = useMutation({
    mutationFn: () =>
      api.photoExports.create(structureId, {
        pattern,
        filters,
        ...(state ? { state } : {}),
        ...(sort ? { sort } : {}),
      }),
    onSuccess: (created) => {
      setExportId(created.id);
      setMissing(created.missing);
    },
  });
  const current = useQuery({
    queryKey: [short, 'photo-exports', exportId],
    queryFn: () => api.photoExports.get(exportId!),
    enabled: !!exportId,
    refetchInterval: (query) => {
      const status = (query.state.data as PhotoExport | undefined)?.status;
      return status === 'queued' || status === 'running' ? 1500 : false;
    },
  });
  const download = async () => {
    try {
      const { url } = await api.photoExports.download(exportId!);
      window.location.assign(url);
    } catch (error) {
      toast.error(error);
    }
  };
  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setExportId(undefined);
      start.reset();
    }
  };

  const status = current.data?.status;
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Exporter les photos (ZIP)"
      description="Photos des fiches affichées, avec les filtres en cours."
      footer={
        !exportId ? (
          <>
            <Button variant="outline" onClick={() => close(false)}>
              Annuler
            </Button>
            <Button onClick={() => start.mutate()} disabled={start.isPending}>
              {start.isPending && <Spinner />} Préparer l’archive
            </Button>
          </>
        ) : (
          <Button onClick={download} disabled={status !== 'succeeded'}>
            <Download /> Télécharger
          </Button>
        )
      }
    >
      {!exportId ? (
        <div className="space-y-4">
          <FormRow label="Nommage des fichiers" htmlFor="photo-pattern">
            <Input
              id="photo-pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              aria-describedby="photo-pattern-help"
            />
          </FormRow>
          <div id="photo-pattern-help" className="text-xs text-muted">
            <p className="mb-1">
              « / » crée un dossier ; l’extension est ajoutée automatiquement. Jetons :
            </p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              {TOKENS.map(([token, help]) => (
                <li key={token}>
                  <code className="text-foreground">{token}</code> {help}
                </li>
              ))}
            </ul>
          </div>
          {start.error && <ErrorMessage error={start.error} />}
        </div>
      ) : (
        <div className="space-y-2 text-sm" aria-live="polite">
          {current.error && <ErrorMessage error={current.error} />}
          {(status === 'queued' || status === 'running' || !status) && (
            <p className="flex items-center gap-2">
              <Spinner /> Préparation de l’archive ({current.data?.fileCount ?? '…'} photo(s))…
            </p>
          )}
          {status === 'succeeded' && current.data && (
            <p>
              Archive prête : {current.data.fileCount} photo(s), {formatSize(current.data.size)}.
              Disponible jusqu’au {formatDateTime(current.data.expiresAt, timeZone)}.
            </p>
          )}
          {status === 'failed' && (
            <p className="text-danger">Échec de l’export : {current.data?.error}</p>
          )}
          {missing > 0 && (
            <p className="text-muted">
              {missing} photo(s) non encore synchronisée(s) depuis le terrain : non incluse(s).
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
