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
