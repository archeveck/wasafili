import { useQuery } from '@tanstack/react-query';
import { type FieldServices } from '@wasafili/form-renderer';
import { type FileRef } from '@wasafili/form-schema';
import { FileText, Trash2 } from 'lucide-react';

/** Aperçu d'un fichier déposé (miniature si disponible). */
export function FilePreview({
  file,
  services,
  onRemove,
}: {
  file: FileRef;
  services: FieldServices;
  onRemove?: () => void;
}) {
  const id = file.annotatedFileId ?? file.fileId;
  const urls = useQuery({
    queryKey: ['file', id],
    queryFn: () => services.fileUrl!(id),
    enabled: !!services.fileUrl,
    staleTime: 10 * 60_000,
  });
  const isImage = file.mimeType?.startsWith('image/') ?? true;
  const src = urls.data?.thumbnailUrl ?? (isImage ? urls.data?.url : null);
  return (
    <div className="group relative size-24 overflow-hidden rounded-md border border-border bg-subtle">
      {src ? (
        <a href={urls.data?.url ?? undefined} target="_blank" rel="noreferrer">
          <img src={src} alt={file.name ?? 'Fichier'} className="size-full object-cover" />
        </a>
      ) : (
        <a
          href={urls.data?.url ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center text-xs text-muted"
        >
          <FileText className="size-6" />
          <span className="line-clamp-2 break-all">{file.name ?? 'Fichier'}</span>
        </a>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Retirer"
          className="absolute right-1 top-1 rounded bg-white/90 p-1 opacity-0 shadow group-hover:opacity-100 focus:opacity-100"
        >
          <Trash2 className="size-3.5 text-danger" />
        </button>
      )}
    </div>
  );
}
