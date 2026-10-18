import { buildDocx, paragraph, run, table } from './build-docx';

/**
 * Modèle « Rapport d'inspection » de la démonstration, pour la fixture `inspectionEquipement`.
 * Montre les trois usages : valeurs, boucle sur un tableau répétable, images.
 */
export function demoReportDocx(): Buffer {
  const label = (text: string) => paragraph([run(text, { bold: true })]);
  return buildDocx(
    [
      paragraph([run("Rapport d'inspection", { bold: true, size: 20, color: '1F4E79' })]),
      paragraph([run('{{_instance}} — {{_formulaire}}', { color: '5B6470' })]),
      table([
        [label('Site'), '{{site}}', label('Bâtiment'), '{{batiment}}'],
        [label('Équipement'), '{{equipement}}', label('Date'), '{{date_inspection}}'],
        [label('Inspecteur'), '{{inspecteur}}', label('État de la fiche'), '{{_etat}}'],
      ]),
      paragraph(''),
      paragraph([run('Constat', { bold: true, size: 14 })]),
      paragraph([run('État constaté : ', { bold: true }), run('{{etat}}')]),
      paragraph('{{description_defaut}}'),
      paragraph([run('Position : ', { bold: true }), run('{{position}}')]),
      paragraph('{{@photos:8}}'),
      paragraph([run('Pièces remplacées', { bold: true, size: 14 })]),
      table(
        [
          ['Référence', 'Quantité', 'Prix unitaire', 'Montant'],
          [
            '{{#pieces}}{{reference}}',
            '{{quantite}}',
            '{{prix_unitaire}}',
            '{{montant}}{{/pieces}}',
          ],
        ],
        { header: true },
      ),
      paragraph([run('Total des pièces : ', { bold: true }), run('{{total_pieces}}')]),
      paragraph(''),
      paragraph([run('Signature', { bold: true })]),
      paragraph('{{@signature}}'),
      paragraph([
        run('Fiche {{_identifiant}} — rapport généré le {{_genere_le}}', {
          size: 8,
          color: '8A94A3',
        }),
      ]),
    ].join(''),
  );
}
