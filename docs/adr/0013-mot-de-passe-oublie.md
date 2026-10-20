# ADR 0013 — Mot de passe oublié en libre-service

- Statut : accepté
- Décisions liées : ADR [0002](0002-auth.md) (authentification), [0009](0009-rapports-automatisations.md)
  (relais SMTP par le worker), [0011](0011-api-publique-exploitation.md) ; ASVS 2.5 et 2.2.3
  ([checklist](../security/asvs-l1.md))

## Contexte

Seul un administrateur d'instance pouvait réinitialiser un mot de passe (mot de passe provisoire),
et jamais pour un compte membre de plusieurs instances. Un technicien qui oublie son mot de passe
sur le terrain restait bloqué. Les comptes sont globaux (une adresse, plusieurs instances) : la
récupération ne peut dépendre d'aucune instance.

## Décision

1. **Deux routes publiques**, limitées par IP comme `/v1/oauth/token` :
   `POST /v1/password-reset` `{ email }` → `202`, et `POST /v1/password-reset/confirm`
   `{ token, password }` → `204`.
2. **La demande ne révèle rien** : même réponse, vide, que le compte existe ou non ; le travail
   (lecture, écriture, mise en file) se fait après la réponse, pour que sa durée ne le trahisse
   pas non plus. Compte désactivé : rien n'est envoyé.
3. **Jeton** aléatoire de 256 bits, stocké haché (SHA-256) dans `password_reset_tokens`, table
   globale comme `users` et `refresh_tokens` (sans `instance_id`, donc sans RLS) ; valable
   30 minutes, à usage unique (consommation atomique), une seule demande en cours par compte.
   Au plus un e-mail toutes les 2 minutes par compte (pas d'envoi en rafale vers une victime).
4. **Lien** vers le back-office, `APP_URL/mot-de-passe/nouveau#token=…` : le fragment n'est
   jamais envoyé au serveur (ni journaux, ni `Referer`) et la page le retire aussitôt de
   l'adresse. Sur mobile, le lien s'ouvre dans le navigateur ; on revient ensuite se connecter.
5. **Nouveau mot de passe** : même politique qu'ailleurs (`passwordSchema`), toutes les sessions
   fermées, puis un e-mail d'avis au titulaire, sans lien (ASVS 2.2.3). Demande et
   réinitialisation sont tracées dans le journal d'audit de chaque instance du compte
   (`auth.password_reset_request`, `auth.password_reset`).
6. **E-mail de compte** : job `account-email` relayé en SMTP par le worker (seul relais, ADR
   0009), **hors du journal d'envoi** : celui-ci appartient à une instance et ses
   administrateurs le lisent, or le message porte un lien d'accès au compte. Le job est retiré
   de Redis dès qu'il se termine (succès ou échec définitif), après les retentatives habituelles
   des e-mails (≈ 15 minutes).

## Conséquences

- Écart ASVS 2.5 levé ; la réinitialisation par un administrateur reste disponible (compte sans
  e-mail joignable).
- Le lien ne vit que dans Redis le temps de l'envoi, puis dans la boîte du destinataire.
- Sans worker ou sans SMTP, aucun e-mail ne part : la demande reste silencieuse pour
  l'utilisateur (journal du worker en échec après les retentatives).
- Limites : pas de traduction des e-mails (français) ; l'avis de changement n'est envoyé que
  pour la réinitialisation, pas pour le changement depuis le compte (déjà connecté).
