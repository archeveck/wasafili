import { type FieldState, type ValidationError } from '@tesserax/form-engine';
import { type SimpleField } from '@tesserax/form-schema';

/**
 * Contrat d'un composant de champ (P2.2.1), identique sur le web et le mobile : chaque
 * plateforme fournit ses implémentations, l'état (visible, requis, lecture seule) et les erreurs
 * viennent toujours du moteur.
 */
export interface FieldProps<F extends SimpleField = SimpleField, V = unknown> {
  field: F;
  value: V | null | undefined;
  onChange: (value: V | null) => void;
  state: FieldState;
  errors: ValidationError[];
  /** Identifiant DOM / accessibilité unique dans le formulaire. */
  inputId: string;
}

/** Résolution des données externes (référentiels, utilisateurs, fichiers), propre à l'hôte. */
export interface FieldServices {
  listItems?: (
    listId: string,
    options: { parentId?: string; level?: number; q?: string },
  ) => Promise<{ id: string; label: string; code: string | null }[]>;
  uploadFile?: (
    file: Blob & { name?: string },
  ) => Promise<{ id: string; name: string; mimeType: string; size: number }>;
  fileUrl?: (fileId: string) => Promise<{ url: string | null; thumbnailUrl: string | null }>;
  users?: () => Promise<{ id: string; label: string }[]>;
}
