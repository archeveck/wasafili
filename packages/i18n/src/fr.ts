export const fr = {
  app: { name: 'Tesserax' },
  auth: {
    login: 'Se connecter',
    logout: 'Se déconnecter',
    email: 'Adresse e-mail',
    password: 'Mot de passe',
    invalidCredentials: 'Identifiants invalides',
    selectInstance: 'Choisir un espace',
  },
  validation: {
    required: 'Ce champ est obligatoire',
    type: 'Valeur invalide',
    unknown_field: 'Champ inconnu',
    min_length: 'Au moins {{min}} caractères',
    max_length: 'Au plus {{max}} caractères',
    pattern: 'Format invalide',
    email: 'Adresse e-mail invalide',
    phone: 'Numéro de téléphone invalide',
    min: 'Valeur minimale : {{min}}',
    max: 'Valeur maximale : {{max}}',
    decimals: 'Au plus {{max}} décimale(s)',
    step: 'Valeur par pas de {{step}}',
    integer: 'Nombre entier attendu',
    option: 'Choix invalide',
    min_items: 'Au moins {{min}} élément(s)',
    max_items: 'Au plus {{max}} élément(s)',
    accuracy: 'Précision GPS insuffisante (max. {{max}} m)',
    min_rows: 'Au moins {{min}} ligne(s)',
    max_rows: 'Au plus {{max}} ligne(s)',
    read_only: 'Champ non modifiable',
  },
  common: {
    save: 'Enregistrer',
    cancel: 'Annuler',
    delete: 'Supprimer',
    loading: 'Chargement…',
    offline: 'Hors ligne',
  },
} as const;

/** Forme des messages : même arborescence que `fr`, valeurs libres. */
type Messages<T> = { [K in keyof T]: T[K] extends string ? string : Messages<T[K]> };
export type MessageTree = Messages<typeof fr>;
