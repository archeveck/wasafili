import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Date et heure dans le fuseau de l'instance (D14). */
export function formatDateTime(value: string | Date, timeZone = 'Africa/Abidjan') {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

export function formatDate(value: string, timeZone = 'Africa/Abidjan') {
  // Une date calendaire (AAAA-MM-JJ) n'a pas de fuseau : l'afficher telle quelle.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}/${m}/${y}`;
  }
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeZone }).format(new Date(value));
}

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
