import {
  conditionSchema,
  fieldValueSchema,
  rootValueFields,
  type StructureDefinition,
  COMPUTED_TYPES,
} from '@tesserax/form-schema';
import { inspectLogic } from '@tesserax/form-engine';
import { z } from 'zod';

/**
 * Définition d'une automatisation (P5.3) : déclencheur → condition json-logic → actions
 * exécutées dans l'ordre. Les textes (sujet, corps, titre) acceptent les balises `{{champ}}`
 * des rapports, plus `{{_lien}}` (lien vers la fiche dans le back-office).
 */

const CRON = /^(\S+\s+){4}\S+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('submission_created') }),
  /** Vers l'un des états donnés (aucun = tout changement d'état). */
  z.object({
    type: z.literal('state_changed'),
    to: z.array(z.string().min(1)).max(50).default([]),
  }),
  z.object({ type: z.literal('field_changed'), fields: z.array(z.string().min(1)).min(1).max(50) }),
  /** Cron à 5 champs, dans le fuseau de l'instance (ex. `0 8 * * 1` : lundi 8 h). */
  z.object({
    type: z.literal('schedule'),
    cron: z.string().trim().regex(CRON, 'Expression cron à 5 champs attendue'),
  }),
]);

export const recipientSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('address'), email: z.email() }),
  z.object({ type: z.literal('author') }),
  /** Champ e-mail de la fiche. */
  z.object({ type: z.literal('field'), field: z.string().min(1) }),
  z.object({ type: z.literal('user'), userId: z.uuid() }),
  z.object({ type: z.literal('group'), groupId: z.uuid() }),
]);

const text = (max: number) => z.string().trim().min(1).max(max);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('email'),
    to: z.array(recipientSchema).min(1).max(20),
    subject: text(300),
    body: text(10_000),
    /** Rapport PDF de la fiche joint à l'e-mail. */
    reportId: z.uuid().optional(),
  }),
  z.object({
    type: z.literal('notify'),
    to: z.array(recipientSchema).min(1).max(20),
    title: text(200),
    body: z.string().trim().max(1000).optional(),
  }),
  z.object({
    type: z.literal('create_task'),
    title: text(200),
    description: z.string().trim().max(5000).optional(),
    /** Formulaire de la tâche ; absent = celui de la fiche. */
    structureId: z.uuid().optional(),
    assignee: z.discriminatedUnion('type', [
      z.object({ type: z.literal('none') }),
      z.object({ type: z.literal('author') }),
      z.object({ type: z.literal('user'), userId: z.uuid() }),
      z.object({ type: z.literal('group'), groupId: z.uuid() }),
    ]),
    /** Jours après le déclenchement (0 = le jour même). */
    startInDays: z.number().int().min(0).max(365).default(1),
    startTime: z.string().regex(TIME, 'Heure HH:MM attendue').default('08:00'),
    durationMinutes: z
      .number()
      .int()
      .min(15)
      .max(24 * 60)
      .default(60),
    /** Pré-remplit la nouvelle fiche avec les champs de même clé et de même type. */
    copyFields: z.boolean().default(false),
  }),
  z.object({ type: z.literal('webhook'), webhookId: z.uuid() }),
  /** Écrit une valeur fixe dans un champ de la fiche (anti-boucle : ADR 0009). */
  z.object({ type: z.literal('update_field'), field: z.string().min(1), value: z.unknown() }),
]);

export type Trigger = z.infer<typeof triggerSchema>;
export type Recipient = z.infer<typeof recipientSchema>;
export type Action = z.infer<typeof actionSchema>;

export const automationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  enabled: z.boolean().default(true),
  structureId: z.uuid().nullable().optional(),
  trigger: triggerSchema,
  conditions: conditionSchema.nullable().optional(),
  actions: z.array(actionSchema).min(1).max(20),
});

export type AutomationInput = z.infer<typeof automationSchema>;

export interface References {
  definition: StructureDefinition | undefined;
  /** Rapports de la structure. */
  reports: Set<string>;
  webhooks: Set<string>;
  users: Set<string>;
  groups: Set<string>;
  structures: Map<string, StructureDefinition | undefined>;
}

/**
 * Vérifications qui dépendent de la structure et des données de l'instance. Renvoie la liste
 * des problèmes, en français, chacun rattaché à son emplacement (`actions.1.field`…).
 */
export function checkAutomation(input: AutomationInput, refs: References) {
  const problems: { path: string; message: string }[] = [];
  const problem = (path: string, message: string) => problems.push({ path, message });
  const scheduled = input.trigger.type === 'schedule';
  const definition = refs.definition;
  const fields = new Map(
    definition ? rootValueFields(definition.fields).map((f) => [f.key, f]) : [],
  );
  const states = new Set(definition?.workflow?.states.map((s) => s.key) ?? []);

  if (!scheduled && !input.structureId) problem('structureId', 'Formulaire surveillé requis');
  if (input.structureId && !definition) problem('structureId', 'Formulaire sans version publiée');
  if (scheduled && input.conditions)
    problem('conditions', 'Pas de condition pour un déclencheur planifié');

  if (input.trigger.type === 'state_changed') {
    if (definition && !definition.workflow) problem('trigger', 'Ce formulaire n’a pas de workflow');
    input.trigger.to.forEach((state, i) => {
      if (definition?.workflow && !states.has(state))
        problem(`trigger.to.${i}`, `État inconnu : ${state}`);
    });
  }
  if (input.trigger.type === 'field_changed') {
    input.trigger.fields.forEach((key, i) => {
      if (definition && !fields.has(key)) problem(`trigger.fields.${i}`, `Champ inconnu : ${key}`);
    });
  }
  if (input.conditions) {
    const { issues } = inspectLogic(input.conditions);
    if (issues.length > 0) problem('conditions', `Condition invalide : ${issues[0]!.detail}`);
  }

  const recipients = (path: string, list: Recipient[], kind: 'email' | 'notify') =>
    list.forEach((r, j) => {
      const at = `${path}.to.${j}`;
      if (r.type === 'author' && scheduled)
        problem(at, 'Pas d’auteur sans fiche (déclencheur planifié)');
      if (r.type === 'field') {
        if (scheduled) problem(at, 'Pas de champ sans fiche (déclencheur planifié)');
        else if (fields.get(r.field)?.type !== 'email')
          problem(at, `« ${r.field} » n'est pas un champ e-mail`);
      }
      if (kind === 'notify' && (r.type === 'address' || r.type === 'field')) {
        problem(at, 'Une notification s’adresse à des utilisateurs de l’instance');
      }
      if (r.type === 'user' && !refs.users.has(r.userId)) problem(at, 'Utilisateur inconnu');
      if (r.type === 'group' && !refs.groups.has(r.groupId)) problem(at, 'Groupe inconnu');
    });

  input.actions.forEach((action, i) => {
    const path = `actions.${i}`;
    switch (action.type) {
      case 'email':
        recipients(path, action.to, 'email');
        if (action.reportId) {
          if (scheduled)
            problem(`${path}.reportId`, 'Pas de rapport sans fiche (déclencheur planifié)');
          else if (!refs.reports.has(action.reportId))
            problem(`${path}.reportId`, 'Rapport inconnu pour ce formulaire');
        }
        break;
      case 'notify':
        recipients(path, action.to, 'notify');
        break;
      case 'create_task': {
        const target = action.structureId ?? input.structureId ?? undefined;
        if (!target) problem(`${path}.structureId`, 'Formulaire de la tâche requis');
        else if (action.structureId && !refs.structures.has(action.structureId)) {
          problem(`${path}.structureId`, 'Formulaire inconnu');
        } else if (action.structureId && !refs.structures.get(action.structureId)) {
          problem(`${path}.structureId`, 'Formulaire sans version publiée');
        }
        if (action.assignee.type === 'author' && scheduled)
          problem(`${path}.assignee`, 'Pas d’auteur sans fiche');
        if (action.assignee.type === 'user' && !refs.users.has(action.assignee.userId)) {
          problem(`${path}.assignee`, 'Utilisateur inconnu');
        }
        if (action.assignee.type === 'group' && !refs.groups.has(action.assignee.groupId)) {
          problem(`${path}.assignee`, 'Groupe inconnu');
        }
        if (action.copyFields && scheduled)
          problem(`${path}.copyFields`, 'Pas de champs à copier sans fiche');
        break;
      }
      case 'webhook':
        if (!refs.webhooks.has(action.webhookId)) problem(`${path}.webhookId`, 'Webhook inconnu');
        break;
      case 'update_field': {
        if (scheduled) {
          problem(path, 'Pas de champ à modifier sans fiche (déclencheur planifié)');
          break;
        }
        const field = fields.get(action.field);
        if (!field) problem(`${path}.field`, `Champ inconnu : ${action.field}`);
        else if (COMPUTED_TYPES.has(field.type) || field.type === 'table') {
          problem(
            `${path}.field`,
            `« ${field.label} » ne peut pas être fixé par une automatisation`,
          );
        } else if (
          action.value !== null &&
          !fieldValueSchema(field)!.safeParse(action.value).success
        ) {
          problem(`${path}.value`, `Valeur invalide pour « ${field.label} »`);
        }
        break;
      }
    }
  });
  return problems;
}
