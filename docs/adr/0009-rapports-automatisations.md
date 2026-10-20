# ADR 0009 — Rapports PDF, automatisations et webhooks

- Statut : accepté (Phase 5)
- Décisions liées : D5 de [TASKS.md](../../TASKS.md) ; ADR [0006](0006-stockage-fichiers.md),
  [0008](0008-workflow-taches-notifications.md)

## Contexte

Une fiche validée doit pouvoir produire un rapport PDF à partir d'un modèle rédigé dans Word,
et l'envoyer par e-mail sans intervention. Plus largement, l'administrateur configure sans code
des réactions à la vie des fiches : e-mail, notification, tâche, appel d'un système externe
(n8n), mise à jour d'un champ. Ces réactions ne doivent ni se perdre, ni se répéter, ni
boucler.

## Décision

### Rapports

1. **Modèle DOCX à balises** `{{champ}}`, `{{#tableau}}…{{/tableau}}` (une ligne par ligne du
   tableau répétable) et `{{@photo}}` / `{{@photo:8}}` pour les images (largeur en cm). Le
   fichier passe par le flux des fichiers (URL signée, ADR 0006). Les balises sont détectées à
   l'enregistrement : une erreur de syntaxe est refusée avec une explication en français, une
   balise inconnue de la structure est signalée sans bloquer (la structure évolue).
2. **Fusion docxtemplater** (cœur libre). Le module d'images libre dépend de `xmldom` 0.1,
   vulnérable et abandonné : les images sont insérées par un module maison d'une centaine de
   lignes (médias, relations, types de contenu). Seules les valeurs produites par le serveur
   deviennent du XML brut : un texte saisi dans une fiche est toujours échappé, même placé dans
   une balise `{{@…}}`. La version annotée d'une photo est préférée à l'originale.
3. **Valeurs lisibles** : libellés des choix et référentiels, noms des utilisateurs, dates
   dans le fuseau de l'instance (D14), nombres au format français avec unité. Balises de la
   fiche : `{{_etat}}`, `{{_auteur}}`, `{{_creee_le}}`, `{{_genere_le}}`…
4. **Conversion par Gotenberg, appelée par l'API**. Écart avec le plan (P5.1.3 prévoyait un job
   du worker) : la fusion a besoin des règles métier de l'API (droits de lecture, libellés,
   version de la fiche), l'aperçu et le mobile attendent le PDF, et le travail lourd reste de
   toute façon hors du processus (LibreOffice dans le conteneur Gotenberg). Le PDF est mis en
   cache dans le stockage par **modèle, fichier du modèle et révision de la fiche** : une fiche
   inchangée n'est jamais reconvertie. Le même client sert l'**export PDF d'une liste de
   fiches** (Chromium de Gotenberg) : page HTML autonome produite par l'API, chaque valeur
   échappée, politique de sécurité sans script ni ressource externe, 2 000 fiches au plus.
5. **Aperçu sans fiche** : une fiche d'exemple est générée depuis la structure (valeurs
   types, image grise), pour mettre au point un modèle avant toute saisie.
   5 bis. **Modèles HTML** (spécification « DOCX/HTML ») : mêmes balises et mêmes données que le
   DOCX, moteur maison (`reports/html.ts`). Stockés en base (`report_templates.html`, exactement
   un de `file_id` et `html`) : le stockage refuse les contenus actifs (P7.4.2). Contrôlés à
   l'enregistrement — ni script, ni cadre, ni attribut d'événement, ni ressource externe (images
   `data:` seulement) —, refus expliqués balise par balise. Chaque valeur est échappée, les
   images de la fiche intégrées en `data:`, une politique de sécurité injectée ; Chromium de
   Gotenberg tourne **sans JavaScript ni réseau** (`--chromium-disable-javascript`,
   `--chromium-allow-list=^(file:///tmp/|data:)`). Page A4 portrait, ou `@page` du modèle.
   Cache : la clé porte l'empreinte du HTML (modèle modifié = nouveau PDF).

### E-mails (D5)

6. **Journal d'envoi** (`email_messages`) : l'e-mail est écrit dans la transaction qui le
   décide, puis envoyé en SMTP (nodemailer) par le worker, avec retentatives. Un e-mail envoyé
   n'est jamais renvoyé par un job rejoué ; un échec définitif se renvoie à la main.

### Automatisations

7. **Déclencheur → condition → actions ordonnées.** Déclencheurs : fiche créée, changement
   d'état (vers certains états), champ modifié, planifié (cron, fuseau de l'instance).
   Condition : json-logic évaluée par `form-engine`, avec les mêmes variables que le
   formulaire (`$state`…). Actions : e-mail (rapport PDF joint), notification, tâche
   (pré-remplie par les champs identiques), webhook, mise à jour d'un champ. Les textes
   acceptent les balises des rapports, plus `{{_lien}}` vers la fiche.
8. **Vérifiée à l'enregistrement** contre la structure publiée : états, champs, valeurs,
   destinataires, rapports et webhooks existants ; chaque problème est rattaché à son
   emplacement et affiché dans l'éditeur.
9. **Outbox transactionnelle.** Toute écriture de fiche (API, synchronisation hors ligne,
   automatisation) enregistre dans sa transaction les exécutions à lancer et les livraisons de
   webhooks ; elles sont publiées dans les files après validation. Une panne de Redis entre
   les deux laisse des lignes `queued`/`pending` visibles, jamais un événement perdu en silence.
10. **Exécution dans l'API**, sur une file BullMQ dédiée (`wasafili-automations`) : les actions
    passent par les services métier (droits, validation `form-engine`, historique,
    notifications), ce que le worker, sans ces services, ne pourrait faire qu'en les
    dupliquant. Le worker garde les relais d'entrée-sortie : SMTP, webhooks, push. Avec
    plusieurs répliques de l'API, `AUTOMATIONS_WORKER=false` en retire certaines de la file.
11. **Reprise par étape et idempotence.** Chaque étape réussie est enregistrée avec son effet,
    dans la même transaction quand l'effet est en base (e-mail, notification, livraison), sinon
    avec un identifiant stable (tâche) ou un `clientMutationId` (mise à jour de champ). Une
    reprise, automatique (3 essais, backoff exponentiel) ou manuelle, ne refait que ce qui
    manque. Une erreur de donnée ou de droit (4xx) est définitive d'emblée.
12. **Anti-boucle.** Une révision écrite par une automatisation porte son exécution
    (`automation_run_id`) : une automatisation ne se déclenche jamais sur sa propre écriture,
    et une chaîne d'automatisations s'arrête au-delà de 3 niveaux, avec une exécution
    « ignorée » expliquée dans le journal. L'historique de la fiche nomme l'automatisation.

### Webhooks (P5.4)

13. Abonnements par événement (`submission.created`, `.updated`, `.state_changed`,
    `.deleted`), éventuellement limités à une structure, ou appel par une automatisation.
14. **Signature** : `X-Wasafili-Signature: sha256=<HMAC-SHA256(secret, "<horodatage>.<corps>")>`
    et `X-Wasafili-Timestamp`. Le secret est montré une seule fois (création, rotation) ; il est
    stocké en clair dans la base, sous RLS, car il sert à signer.
15. **Retentatives** exponentielles (8 essais, ≈ 40 min) ; après 5 livraisons échouées d'affilée,
    le webhook est désactivé et la raison affichée. Pas de suivi de redirection, délai de 10 s.
16. **SSRF** : sauf `WEBHOOK_ALLOW_PRIVATE=true` (réseau interne, n8n local), le worker refuse
    les adresses privées, littérales ou **résolues au moment de la connexion** (un nom
    vérifié avant l'envoi pourrait être résolu autrement ensuite).

## Conséquences et limites connues

- **Dépendances ajoutées** : `docxtemplater` et `pizzip` (fusion), `image-size` (dimensions des
  images) côté API ; `nodemailer` et `undici` (agent HTTP filtré) côté worker.
- **Images** : JPEG et PNG uniquement, dans le corps du document (pas dans les en-têtes ou
  pieds de page). Une image absente ou illisible est remplacée par une mention. Modèles HTML :
  JPEG, PNG, WebP et GIF ; un logo s'intègre en `data:`. Pas de condition (`{{^…}}`) ni de
  section sur un champ simple, comme en DOCX.
- **Cache** : un libellé de référentiel ou un nom d'utilisateur modifié après coup n'invalide
  pas un PDF déjà généré pour la même révision.
- **Planifié** : un déclencheur cron ne porte pas de fiche ; les actions qui en exigent une
  (rapport joint, mise à jour de champ, auteur) y sont refusées à l'enregistrement.
- **Mobile** : le rapport se génère en ligne, à partir de la dernière version reçue par le
  serveur. Sur Android, le navigateur intégré télécharge le PDF au lieu de l'afficher.
