import { useFormRenderer } from '@/form/use-form';
import { type StructureDefinition } from '@wasafili/form-schema';
import { FormRenderer } from '@/form/form-renderer';
import { fieldServices } from '@/form/services';
import { useApp } from '@/lib/use-app';
import { Button } from '@/components/ui/button';

function PreviewForm({ definition }: { definition: StructureDefinition }) {
  const { api, me } = useApp();
  const form = useFormRenderer(definition, {
    isNew: true,
    ...(me ? { userId: me.id, roles: me.roles } : {}),
  });
  return (
    <>
      <FormRenderer
        definition={definition}
        form={form}
        services={fieldServices(api)}
        idPrefix="preview"
        compact
      />
      <Button className="mt-6 w-full" onClick={() => form.submit()}>
        Tester la validation
      </Button>
    </>
  );
}

/** Aperçu mobile live (P2.3.4) : le même moteur et le même rendu que la saisie réelle. */
export function MobilePreview({ definition }: { definition: StructureDefinition }) {
  return (
    <div className="relative mx-auto w-[340px] rounded-[2.4rem] border-[9px] border-sidebar bg-sidebar shadow-xl ring-1 ring-foreground/10">
      <div
        className="absolute left-1/2 top-1.5 z-10 h-4 w-20 -translate-x-1/2 rounded-full bg-sidebar"
        aria-hidden
      />
      <div className="h-[640px] overflow-y-auto rounded-[1.7rem] bg-background p-4 pt-8">
        {/* Remontage à chaque modification : l'aperçu repart d'une fiche vierge. */}
        <PreviewForm key={JSON.stringify(definition)} definition={definition} />
      </div>
    </div>
  );
}
