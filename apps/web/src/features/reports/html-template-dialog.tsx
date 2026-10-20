import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormRow, Input, Textarea } from '@/components/ui/form-controls';
import { Dialog } from '@/components/ui/overlays';

/** Point de départ d'un modèle HTML : mêmes balises qu'un modèle Word. */
export const STARTER_HTML = `<!doctype html>
<html lang="fr">
<head>
<style>
  @page { size: A4; margin: 15mm; }
  body { font-family: Arial, sans-serif; color: #1f2933; font-size: 10pt; }
  h1 { color: #14284b; font-size: 16pt; margin: 0 0 4pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 8pt; }
  th, td { border: 0.5pt solid #cbd2d9; padding: 3pt 5pt; text-align: left; }
  th { background: #14284b; color: #fff; }
</style>
</head>
<body>
  <h1>{{_formulaire}}</h1>
  <p>{{_instance}} · état : {{_etat}} · saisie par {{_auteur}} le {{_creee_le}}</p>
  <p>Rapport généré le {{_genere_le}}</p>
</body>
</html>
`;

export interface HtmlTemplateValues {
  name: string;
  filename: string;
  html: string;
}

/**
 * Création ou modification d'un modèle HTML. Le contenu est envoyé tel quel à l'API, qui le
 * contrôle (balises, scripts, ressources externes) et explique ses refus.
 */
export function HtmlTemplateDialog({
  open,
  onOpenChange,
  title,
  initial,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial: HtmlTemplateValues;
  pending: boolean;
  onSubmit: (values: HtmlTemplateValues) => void;
}) {
  const [html, setHtml] = useState(initial.html);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      name: String(form.get('name')).trim(),
      filename: String(form.get('filename') ?? '').trim(),
      html,
    });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="Mêmes balises qu’un modèle Word. Images intégrées en « data: » uniquement : le PDF est produit sans réseau."
      wide
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormRow label="Nom" htmlFor="html-report-name" required>
            <Input
              id="html-report-name"
              name="name"
              required
              maxLength={200}
              defaultValue={initial.name}
            />
          </FormRow>
          <FormRow
            label="Nom du PDF"
            htmlFor="html-report-filename"
            help="Balises admises, ex. Inspection {{equipement}}"
          >
            <Input
              id="html-report-filename"
              name="filename"
              maxLength={200}
              defaultValue={initial.filename}
            />
          </FormRow>
        </div>
        <FormRow label="Modèle HTML" htmlFor="html-report-content" required>
          <Textarea
            id="html-report-content"
            required
            spellCheck={false}
            rows={18}
            className="font-mono text-xs"
            value={html}
            onChange={(e) => setHtml(e.target.value)}
          />
        </FormRow>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-sm text-primary hover:underline">
            Charger un fichier .html
            <input
              type="file"
              accept=".html,.htm,text/html"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setHtml(await file.text());
                e.target.value = '';
              }}
            />
          </label>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending || !html.trim()}>
              {pending ? 'Analyse…' : 'Enregistrer'}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
