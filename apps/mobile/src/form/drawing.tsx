import {
  Canvas,
  Image as SkiaImage,
  ImageFormat,
  Path,
  Skia,
  useCanvasRef,
  useImage,
} from '@shopify/react-native-skia';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, ModalScreen, styles } from '@/components/ui';
import { colors, space } from '@/lib/theme';

interface DrawingProps {
  visible: boolean;
  title: string;
  /** Image de fond (annotation de photo) ; absente pour une signature. */
  backgroundUri?: string;
  strokeColor?: string;
  onCancel: () => void;
  onSave: (png: Uint8Array) => void;
}

/**
 * Dessin à main levée (D13) : signature sur fond blanc, ou annotation d'une photo. Un seul
 * moteur natif (Skia) pour les deux ; l'image exportée ne remplace jamais l'original.
 */
export function DrawingModal({
  visible,
  title,
  backgroundUri,
  strokeColor = colors.text,
  onCancel,
  onSave,
}: DrawingProps) {
  const ref = useCanvasRef();
  const background = useImage(backgroundUri ?? null);
  // Traits en données de chemin SVG (« M x y L x y … ») : SkPath est immuable.
  const [paths, setPaths] = useState<string[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const save = () => {
    const snapshot = ref.current?.makeImageSnapshot();
    if (snapshot) onSave(snapshot.encodeToBytes(ImageFormat.PNG, 100));
    setPaths([]);
  };

  return (
    <ModalScreen visible={visible} onClose={onCancel}>
      <View style={{ padding: space.lg }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.muted}>Dessinez avec le doigt.</Text>
      </View>
      {/* Mesure et gestes sur la vue englobante : Canvas n'accepte pas onLayout (nouvelle architecture). */}
      <View
        style={{
          flex: 1,
          marginHorizontal: space.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: '#fff',
        }}
        onLayout={(event) => setSize(event.nativeEvent.layout)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => {
          const { locationX: x, locationY: y } = event.nativeEvent;
          setPaths((current) => [...current, `M ${x} ${y}`]);
        }}
        onResponderMove={(event) => {
          const { locationX: x, locationY: y } = event.nativeEvent;
          setPaths((current) => [
            ...current.slice(0, -1),
            `${current.at(-1) ?? `M ${x} ${y}`} L ${x} ${y}`,
          ]);
        }}
        accessibilityLabel={title}
        testID="drawing-area"
      >
        <Canvas ref={ref} style={{ flex: 1 }} pointerEvents="none">
          {background && (
            <SkiaImage
              image={background}
              x={0}
              y={0}
              width={size.width}
              height={size.height}
              fit="contain"
            />
          )}
          {paths.map((svg, index) => (
            <Path
              key={index}
              path={Skia.Path.MakeFromSVGString(svg) ?? ''}
              style="stroke"
              strokeWidth={backgroundUri ? 5 : 3}
              strokeCap="round"
              strokeJoin="round"
              color={backgroundUri ? colors.danger : strokeColor}
            />
          ))}
        </Canvas>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm, padding: space.lg }}>
        <Button
          title="Annuler"
          variant="outline"
          style={{ flex: 1 }}
          onPress={() => {
            setPaths([]);
            onCancel();
          }}
        />
        <Button
          title="Effacer"
          variant="outline"
          style={{ flex: 1 }}
          onPress={() => setPaths([])}
        />
        <Button title="Valider" style={{ flex: 1 }} disabled={paths.length === 0} onPress={save} />
      </View>
    </ModalScreen>
  );
}
