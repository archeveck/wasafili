import { expect, type Locator, type Page, test } from '@playwright/test';
import { evaluate, truthy } from '@wasafili/form-engine';
import {
  type Field,
  inspectionEquipement,
  inspectionWorkflow,
  type StructureDefinition,
} from '@wasafili/form-schema';

/**
 * Critère d'acceptation « formulaire Inspection équipement créé sans code en moins de 15 min ».
 *
 * Le parcours reconstruit la structure de démonstration complète (référentiel en cascade,
 * conditions, photos, tableau avec calcul par ligne et total, signature, workflow à quatre
 * états) par les seuls gestes de l'interface, puis vérifie que la version publiée se comporte
 * comme la fixture `inspectionEquipement()`. Chaque geste est compté et converti en temps
 * humain par le modèle KLM (Keystroke-Level Model, Card, Moran et Newell, 1980) : le temps d'un
 * administrateur qui sait quel formulaire construire et ne se trompe pas (une préparation
 * mentale comptée par geste, pas d'hésitation ni d'erreur). C'est une borne basse : un premier
 * usage reste à chronométrer avec une vraie personne. Le parcours garde surtout le designer de
 * toute régression (geste ajouté, clé à ressaisir, défilement…).
 */

const LIMIT_SECONDS = 15 * 60;

/** Opérateurs KLM, en secondes. */
const K = 0.28; // frappe d'une touche (dactylo moyen, 40 mots/min)
const P = 1.1; // pointer une cible à la souris
const B = 0.1; // presser ou relâcher le bouton
const H = 0.4; // passer de la souris au clavier (ou l'inverse)
const M = 1.35; // préparation mentale d'une action

type Gesture = 'clic' | 'saisie' | 'choix' | 'glisser' | 'couleur' | 'défilement';

/** Exécute les gestes et tient le compte du temps humain correspondant. */
class Gestures {
  readonly counts: Record<Gesture, number> = {
    clic: 0,
    saisie: 0,
    choix: 0,
    glisser: 0,
    couleur: 0,
    défilement: 0,
  };
  keystrokes = 0;
  seconds = 0;

  constructor(private readonly page: Page) {}

  private add(gesture: Gesture, seconds: number) {
    this.counts[gesture] += 1;
    this.seconds += seconds;
  }

  /**
   * Une cible masquée (palette ou formulaire défilés) demande d'abord de défiler. Elle est
   * amenée au centre : près d'un bord, le défilement automatique du glisser la déplacerait.
   * Visible signifie « au premier plan à son centre » (pas sous l'en-tête d'un panneau).
   */
  private async reach(target: Locator) {
    const before = await target.boundingBox();
    const visible = await target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return top !== null && (element === top || element.contains(top) || top.contains(element));
    });
    if (visible) return;
    // Un humain fait défiler d'un écran : la cible arrive au milieu, ses voisines avec elle.
    await target.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    if (before?.y !== (await target.boundingBox())?.y) this.add('défilement', M + P + 1);
  }

  async click(target: Locator) {
    await this.reach(target);
    await target.click();
    this.add('clic', M + P + 2 * B);
  }

  /** Cliquer le champ, tout sélectionner (2 touches), taper, revenir à la souris. */
  async type(target: Locator, text: string) {
    await this.reach(target);
    await target.fill(text);
    this.keystrokes += text.length + 2;
    this.add('saisie', M + P + 2 * B + 2 * H + (text.length + 2) * K);
  }

  /** Liste déroulante : l'ouvrir, pointer l'option. */
  async choose(target: Locator, option: string | { label: string }) {
    await this.reach(target);
    await target.selectOption(option);
    this.add('choix', M + 2 * (P + 2 * B));
  }

  /** Sélecteur de couleur : l'ouvrir, saisir le code hexadécimal, le fermer. */
  async color(target: Locator, hex: string) {
    await this.reach(target);
    await target.fill(hex.toLowerCase());
    this.keystrokes += hex.length + 2;
    this.add('couleur', M + 3 * (P + 2 * B) + 2 * H + (hex.length + 2) * K);
  }

  /** Glisser un type de champ de la palette dans une section ou un tableau. */
  async drag(type: string, containerKey: string) {
    const source = this.page.getByRole('button', { name: `Ajouter : ${type}`, exact: true });
    const container = this.page.getByTestId(`field-${containerKey}`);
    const zone = container.getByText(/^(Glissez des champs ici|Déposer ici)$/);
    const children = container.locator('[data-testid^="field-"]');
    await this.reach(source);
    await this.reach(zone);
    await zone.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const fields = this.page.locator('[data-testid^="field-"]');
    const [inside, total] = [await children.count(), await fields.count()];
    // Un seul geste humain ; le robot le rejoue si le capteur ne l'a pas pris (glisser trop
    // tôt après le précédent, pendant l'animation de dépôt).
    for (let attempt = 1; ; attempt++) {
      const from = await source.boundingBox();
      const to = await zone.boundingBox();
      await this.page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
      await this.page.mouse.down();
      // Plusieurs étapes : le capteur de dnd-kit démarre après 4 px de déplacement.
      await this.page.mouse.move(from!.x + 20, from!.y + 20, { steps: 5 });
      await this.page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 15 });
      await this.page.mouse.up();
      const added = await expect(fields)
        .toHaveCount(total + 1, { timeout: 1_000 })
        .then(
          () => true,
          () => false,
        );
      if (added) break;
      if (attempt === 3) throw new Error(`Glisser « ${type} » sans effet`);
    }
    await expect(children, `« ${type} » déposé dans ${containerKey}`).toHaveCount(inside + 1);
    this.add('glisser', M + 2 * P + 2 * B);
  }
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('admin@wasafili.local');
  await page.getByLabel('Mot de passe').fill('Wasafili2026!');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/demo\/structures/);
}

/** Valeur de chaque condition pour les trois états de l'équipement (et sans état). */
const ETATS = ['bon', 'degrade', 'hors_service', undefined];
const outcomes = (logic: unknown) =>
  ETATS.map((etat) => truthy(evaluate(logic as never, { etat })));

/**
 * Définition comparable : sans identifiants ; conditions comparées par leur résultat (l'éditeur
 * visuel écrit `in_list` là où la fixture écrit `in`) ; réglages par défaut explicités.
 */
function normalizeFields(fields: Field[]): unknown[] {
  return fields.map((field) => {
    const { id: _id, visibleIf, requiredIf, ...rest } = field as Field & Record<string, unknown>;
    return {
      ...rest,
      ...(field.type === 'photo' ? { allowAnnotation: rest['allowAnnotation'] !== false } : {}),
      ...(field.type === 'geolocation' ? { allowManual: rest['allowManual'] !== false } : {}),
      ...(visibleIf ? { visibleIf: outcomes(visibleIf) } : {}),
      ...(requiredIf ? { requiredIf: outcomes(requiredIf) } : {}),
      ...('fields' in field ? { fields: normalizeFields(field.fields as Field[]) } : {}),
    };
  });
}

function normalize(definition: StructureDefinition) {
  const workflow = definition.workflow!;
  return {
    fields: normalizeFields(definition.fields),
    states: workflow.states.map(({ position: _position, ...state }) => state),
    transitions: workflow.transitions.map((t) => ({
      ...t,
      from: [...t.from].sort(),
      ...(t.roles ? { roles: [...t.roles].sort() } : {}),
    })),
  };
}

test('« Inspection équipement » se construit sans code en moins de 15 min', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(10_000);
  const g = new Gestures(page);
  const name = `Inspection 15 min ${Date.now()}`;
  // Un champ requis affiche « * » après son libellé.
  const label = (text: string) =>
    page.getByLabel(new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*?$`));
  const button = (text: string) => page.getByRole('button', { name: text, exact: true });
  /** Bloc du panneau de propriétés (« Visible si », « Obligatoire si »). */
  const block = (title: string) =>
    page.locator('div.border-t', { has: page.getByText(title, { exact: true }) }).last();
  /** Libellé, puis clé si celle tirée du libellé ne convient pas (« État général » → etat). */
  const identify = async (text: string, key: string, labelField = 'Libellé') => {
    await g.type(label(labelField), text);
    if ((await label('Clé').inputValue()) !== key) await g.type(label('Clé'), key);
  };
  const condition = async (title: string, operator: 'in' | '==', value: string) => {
    const rules = block(title);
    await g.click(rules.getByRole('button', { name: 'Ajouter une règle' }));
    await g.choose(rules.getByLabel('Champ', { exact: true }), { label: 'État général' });
    await g.choose(rules.getByLabel('Opérateur', { exact: true }), operator);
    if (operator === 'in') await g.type(rules.getByLabel('Valeur', { exact: true }), value);
    else await g.choose(rules.getByLabel('Valeur', { exact: true }), value);
  };
  const visibleIfDamaged = () => condition('Visible si', 'in', 'degrade, hors_service');

  await login(page);
  const started = Date.now();

  await g.click(page.getByRole('button', { name: 'Nouveau formulaire' }));
  await g.type(page.getByLabel('Nom'), name);
  await g.click(page.getByRole('button', { name: 'Créer et concevoir' }));
  await expect(page.getByText('Glissez des champs ici')).toBeVisible();

  // Identification : référentiel en cascade Site > Bâtiment > Équipement, date, inspecteur.
  await g.click(button('Ajouter : Section'));
  await identify('Identification', 'identification');
  for (const [text, key, level, parent] of [
    ['Site', 'site', 'Site', undefined],
    ['Bâtiment', 'batiment', 'Bâtiment', 'Site'],
    ['Équipement', 'equipement', 'Équipement', 'Bâtiment'],
  ] as const) {
    await g.drag('Référentiel', 'identification');
    await identify(text, key);
    await g.click(label('Obligatoire'));
    await g.choose(label('Référentiel'), { label: 'Sites et équipements' });
    await g.choose(label('Niveau proposé'), { label: level });
    if (parent) await g.choose(label('Cascade : filtré par le champ'), { label: parent });
  }
  await g.click(label('Filtrable dans les listes de fiches'));
  await g.drag('Date', 'identification');
  await identify("Date d'inspection", 'date_inspection');
  await g.click(label('Obligatoire'));
  await g.click(label('Filtrable dans les listes de fiches'));
  await g.click(label('Date du jour par défaut'));
  await g.drag('Auteur auto', 'identification');
  await identify('Inspecteur', 'inspecteur');

  // Constat : état en boutons colorés, défaut et photos exigés selon l'état, position.
  await g.click(button('Ajouter : Section'));
  await identify('Constat', 'constat');
  await g.drag('Choix unique', 'constat');
  await identify('État général', 'etat');
  await g.click(label('Obligatoire'));
  await g.click(label('Filtrable dans les listes de fiches'));
  await g.choose(label('Affichage'), 'buttons');
  await g.click(page.getByRole('button', { name: 'Ajouter une option' }));
  for (const [index, text, color] of [
    [1, 'Bon', '#2E8B57'],
    [2, 'Dégradé', '#D98A1B'],
    [3, 'Hors service', '#C4372D'],
  ] as const) {
    await g.type(label(`Libellé de l’option ${index}`), text);
    await g.color(label(`Couleur de l’option ${index}`), color);
  }
  await g.drag('Texte long', 'constat');
  await identify('Description du défaut', 'description_defaut');
  await g.type(label('Longueur max.'), '2000');
  await visibleIfDamaged();
  await condition('Obligatoire si', '==', 'hors_service');
  await g.drag('Photos', 'constat');
  await identify('Photos', 'photos');
  await g.type(label('Nombre max.'), '5');
  await g.type(label('Compression'), '0.7');
  await condition('Obligatoire si', 'in', 'degrade, hors_service');
  await g.drag('Géolocalisation', 'constat');
  await identify('Position', 'position');

  // Pièces à remplacer : tableau répétable, montant par ligne.
  await g.click(button('Ajouter : Tableau répétable'));
  await identify('Pièces à remplacer', 'pieces');
  await g.type(label('Lignes max.'), '20');
  await visibleIfDamaged();
  await g.click(page.getByTestId('field-pieces').getByRole('button', { name: /^Colonne 1/ }));
  await identify('Référence', 'reference');
  await g.click(label('Obligatoire'));
  await g.drag('Nombre', 'pieces');
  await identify('Quantité', 'quantite');
  await g.type(label('Minimum'), '1');
  await g.type(label('Décimales'), '0');
  await g.type(label('Valeur par défaut'), '1');
  await g.drag('Nombre', 'pieces');
  await identify('Prix unitaire', 'prix_unitaire');
  await g.type(label('Minimum'), '0');
  await g.type(label('Unité'), 'FCFA');
  await g.drag('Calcul', 'pieces');
  await identify('Montant', 'montant');
  await g.type(label('Formule'), '{quantite} * {prix_unitaire}');
  await g.type(label('Décimales'), '0');

  await g.click(button('Ajouter : Calcul'));
  await identify('Total pièces (FCFA)', 'total_pieces');
  await g.type(label('Formule'), 'SOMME({pieces.montant})');
  await g.type(label('Décimales'), '0');
  await visibleIfDamaged();
  await g.click(button('Ajouter : Signature'));
  await identify('Signature', 'signature');
  await g.click(label('Obligatoire'));
  await g.click(button('Ajouter : Horodatage auto'));
  await identify('Créée le', 'cree_le');

  // Workflow Brouillon → Soumis → Validé / Rejeté.
  await g.click(page.getByRole('tab', { name: 'Workflow' }));
  await g.click(page.getByRole('button', { name: 'Ajouter un workflow' }));
  for (const [text, key, color, final] of [
    ['Soumis', 'soumis', '#1F6F5C', false],
    ['Validé', 'valide', '#2E8B57', true],
    ['Rejeté', 'rejete', '#C4372D', false],
  ] as const) {
    await g.click(button('État'));
    await identify(text, key);
    await g.color(label('Couleur'), color);
    if (final) await g.click(page.getByRole('button', { name: 'Marquer comme final' }));
  }
  const graph = page.getByRole('region', { name: 'Graphe du workflow' });
  const transition = async (from: string, to: string, text: string, key: string) => {
    await g.click(graph.getByText(from, { exact: true }));
    await g.choose(page.getByLabel('État cible'), { label: to });
    await g.click(page.getByRole('button', { name: 'Transition' }));
    await identify(text, key, 'Libellé du bouton');
  };
  const roles = page.getByRole('group', { name: 'Rôles autorisés' });
  await transition('Brouillon', 'Soumis', 'Soumettre', 'soumettre');
  await g.click(page.getByRole('group', { name: 'États de départ' }).getByText('Rejeté'));
  await transition('Soumis', 'Validé', 'Valider', 'valider');
  await g.color(label('Couleur du bouton'), '#2E8B57');
  await g.click(roles.getByText('Administrateur'));
  await g.click(roles.getByText('Superviseur'));
  await transition('Soumis', 'Rejeté', 'Rejeter', 'rejeter');
  await g.color(label('Couleur du bouton'), '#C4372D');
  await g.click(roles.getByText('Administrateur'));
  await g.click(roles.getByText('Superviseur'));
  await g.type(label('Confirmation'), 'Rejeter cette inspection ?');
  // « Soumettre » part de deux états : quatre flèches.
  await expect(page.locator('.react-flow__edge')).toHaveCount(4);

  await g.click(page.getByRole('button', { name: 'Publier' }));
  await expect(page.getByText('Version 1 publiée')).toBeVisible();
  const robotSeconds = (Date.now() - started) / 1000;

  // La version publiée se comporte comme la structure de démonstration.
  const structureId = /\/structures\/([0-9a-f-]+)\/designer/.exec(page.url())![1];
  // Jeton de la session du navigateur : pas de connexion de plus (limite par IP).
  const tokens = await page.evaluate(() => localStorage.getItem('wasafili.tokens'));
  const headers = { authorization: `Bearer ${JSON.parse(tokens!).access_token}` };
  const lists = await (await request.get('/v1/demo/lists?per_page=100', { headers })).json();
  const listId = lists.data.find((l: { name: string }) => l.name === 'Sites et équipements').id;
  const structure = `/v1/demo/structures/${structureId}`;
  const version = await (await request.get(`${structure}/versions/current`, { headers })).json();
  // Archivé : il ne se mêle pas aux formulaires de démonstration des autres parcours.
  expect((await request.delete(structure, { headers })).ok()).toBe(true);
  expect(normalize(version.definition)).toEqual(
    normalize({ ...inspectionEquipement({ listId }), workflow: inspectionWorkflow }),
  );

  const minutes = (s: number) => `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  const summary =
    `${Object.entries(g.counts)
      .map(([gesture, count]) => `${count} ${gesture}`)
      .join(', ')} (${g.keystrokes} frappes) → ` +
    `estimation KLM ${minutes(g.seconds)} (marge ${minutes(LIMIT_SECONDS - g.seconds)}) ; ` +
    `parcours automatisé ${minutes(robotSeconds)}`;
  test.info().annotations.push({ type: 'durée', description: summary });
  console.log(summary);
  expect(g.seconds).toBeLessThan(LIMIT_SECONDS);
});
