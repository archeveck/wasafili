export const fr = {
  app: { name: 'Wasafili' },
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
  audit: {
    actions: {
      auth: {
        login: 'Connexion',
        login_failed: 'Connexion refusée',
        client_token: 'Jeton de clé API',
        client_token_failed: 'Clé API refusée',
        password_change: 'Mot de passe changé',
      },
      apikey: {
        create: 'Clé API créée',
        update: 'Clé API modifiée',
        secret: 'Secret de clé API régénéré',
        revoke: 'Clé API révoquée',
      },
      user: {
        create: 'Membre ajouté',
        update: 'Membre modifié',
        remove: 'Membre retiré',
        password_reset: 'Mot de passe réinitialisé',
      },
      role: {
        create: 'Rôle créé',
        update: 'Rôle modifié',
        delete: 'Rôle supprimé',
      },
      group: {
        create: 'Groupe créé',
        update: 'Groupe renommé',
        delete: 'Groupe supprimé',
        members: 'Membres du groupe modifiés',
      },
      settings: {
        update: 'Paramètres modifiés',
      },
      structure: {
        create: 'Formulaire créé',
        update: 'Formulaire modifié',
        delete: 'Formulaire archivé',
        publish: 'Formulaire publié',
        access: 'Droits du formulaire modifiés',
      },
      list: {
        create: 'Référentiel créé',
        update: 'Référentiel modifié',
        delete: 'Référentiel supprimé',
        import: 'Référentiel importé',
      },
      report: {
        create: 'Modèle de rapport créé',
        update: 'Modèle de rapport modifié',
        delete: 'Modèle de rapport supprimé',
        render: 'Rapport PDF généré',
      },
      automation: {
        create: 'Automatisation créée',
        update: 'Automatisation modifiée',
        delete: 'Automatisation supprimée',
      },
      automation_run: {
        retry: 'Exécution relancée',
      },
      webhook: {
        create: 'Webhook créé',
        update: 'Webhook modifié',
        delete: 'Webhook supprimé',
        secret: 'Secret de webhook renouvelé',
      },
      webhook_delivery: {
        retry: 'Livraison de webhook relancée',
      },
      email: {
        retry: 'E-mail renvoyé',
      },
      dashboard: {
        create: 'Tableau de bord créé',
        update: 'Tableau de bord modifié',
        delete: 'Tableau de bord supprimé',
      },
      submission: {
        export: 'Export de fiches (tableur)',
        photos_export: 'Export des photos (ZIP)',
      },
      photo_export: {
        download: 'Archive de photos téléchargée',
      },
    },
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
