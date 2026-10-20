import { Camera, type CameraRef, Marker } from '@maplibre/maplibre-react-native';
import { type GeoPoint } from '@wasafili/form-schema';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { BaseMap, IVORY_COAST } from '@/components/base-map';
import { styles } from '@/components/ui';
import { colors, radius, space } from '@/lib/theme';

/** Zoom de rue, où l'on distingue un bâtiment. */
const STREET_ZOOM = 16;

/**
 * Carte d'un champ géolocalisation : repère sur la position, toucher la carte le déplace
 * (`onPick`, absent en lecture seule). La vue suit une position venue du GPS ou de la saisie ;
 * un point posé sur la carte ne la déplace pas (il est déjà sous le doigt).
 */
export function PointMap({
  point,
  onPick,
}: {
  point: GeoPoint | null;
  onPick?: (lngLat: [number, number]) => void;
}) {
  const camera = useRef<CameraRef>(null);
  const [initialViewState] = useState(() =>
    point
      ? { center: [point.lng, point.lat] as [number, number], zoom: STREET_ZOOM }
      : { bounds: IVORY_COAST },
  );
  const followed = point && point.source !== 'map' ? `${point.lng},${point.lat}` : null;
  useEffect(() => {
    if (!followed) return;
    const [lng, lat] = followed.split(',').map(Number) as [number, number];
    try {
      void camera.current
        ?.setStop({ center: [lng, lat], zoom: STREET_ZOOM, duration: 500, easing: 'ease' })
        .catch(() => undefined);
    } catch {
      // Carte pas encore initialisée : la vue initiale couvre ce cas.
    }
  }, [followed]);

  return (
    <View style={{ gap: space.xs }}>
      <View
        style={{
          height: 220,
          borderRadius: radius.md,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <BaseMap
          style={{ flex: 1 }}
          accessibilityLabel="Carte de la position"
          onPress={onPick ? (event) => onPick(event.nativeEvent.lngLat) : undefined}
        >
          <Camera ref={camera} initialViewState={initialViewState} />
          {point ? (
            <Marker lngLat={[point.lng, point.lat]} anchor="center">
              <View
                accessibilityLabel="Position retenue"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: colors.primary,
                  borderWidth: 3,
                  borderColor: '#ffffff',
                }}
              />
            </Marker>
          ) : null}
        </BaseMap>
      </View>
      {onPick ? (
        <Text style={styles.muted}>Touchez la carte pour placer ou déplacer le point.</Text>
      ) : null}
    </View>
  );
}
