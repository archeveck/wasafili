import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Dates dans le fuseau de l'instance (D14) : mêmes formats que sur le mobile. */
export { formatDate, formatDateTime } from '@wasafili/form-renderer';

/** Téléchargement d'un Blob reçu de l'API. */
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function slugify(label: string) {
  return (
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'c_$1')
      .slice(0, 50) || 'champ'
  );
}

/**
 * Onglet ouvert au clic (geste de l'utilisateur, donc non bloqué), dirigé ensuite vers une
 * adresse obtenue de façon asynchrone (PDF généré par l'API). Fermé en cas d'échec.
 */
export function pendingTab() {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  return {
    go: (url: string) => (tab ? tab.location.replace(url) : window.open(url, '_blank', 'noopener')),
    close: () => tab?.close(),
  };
}
