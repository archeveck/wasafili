import { Eraser } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';

/** Signature au doigt ou à la souris ; exportée en PNG à la validation. */
export function SignaturePad({
  onSave,
  disabled,
}: {
  onSave: (png: Blob) => void;
  disabled?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drawn = useRef(false);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * event.currentTarget.width,
      ((event.clientY - rect.top) / rect.height) * event.currentTarget.height,
    ] as const;
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvas}
        width={600}
        height={200}
        aria-label="Zone de signature"
        className="h-32 w-full touch-none rounded-md border border-dashed border-border bg-white"
        onPointerDown={(event) => {
          if (disabled) return;
          const ctx = event.currentTarget.getContext('2d')!;
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(...point(event));
          drawing.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const ctx = event.currentTarget.getContext('2d')!;
          ctx.lineTo(...point(event));
          ctx.stroke();
          drawn.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            const element = canvas.current!;
            element.getContext('2d')!.clearRect(0, 0, element.width, element.height);
            drawn.current = false;
          }}
        >
          <Eraser /> Effacer
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => {
            if (!drawn.current) return;
            canvas.current!.toBlob((blob) => blob && onSave(blob), 'image/png');
          }}
        >
          Valider la signature
        </Button>
      </div>
    </div>
  );
}
