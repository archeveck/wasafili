import { type ValidationError } from '@tesserax/form-engine';

export type Translate = (key: string, params?: Record<string, unknown>) => string;

/** Message lisible d'une erreur de validation (clés `validation.<code>` de @tesserax/i18n). */
export function validationMessage(error: ValidationError, translate: Translate): string {
  if (error.code === 'pattern' && typeof error.params?.['message'] === 'string') {
    return error.params['message'];
  }
  return translate(`validation.${error.code}`, error.params);
}

/** Erreurs d'un chemin donné (`['cle']` ou `['tableau', 0, 'colonne']`). */
export function errorsAt(errors: readonly ValidationError[], path: readonly (string | number)[]) {
  return errors.filter(
    (error) => error.path.length === path.length && error.path.every((part, i) => part === path[i]),
  );
}
