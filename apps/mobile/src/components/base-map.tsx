import { type LngLatBounds, Map, type MapProps } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import { basemapStyle, useBasemap } from '@/lib/basemap';

/** Vue par défaut : Côte d'Ivoire (ouest, sud, est, nord). */
export const IVORY_COAST: LngLatBounds = [-8.6, 4.3, -2.5, 10.7];

/**
 * Carte MapLibre sur le fond hors ligne de l'appareil (`lib/basemap`), fond neutre à défaut.
 * Le style change de lui-même quand le fond est téléchargé ou supprimé.
 */
export function BaseMap(props: Omit<MapProps, 'mapStyle'>) {
  const ready = useBasemap().status === 'ready';
  const style = useMemo(() => basemapStyle(ready), [ready]);
  return (
    <Map
      mapStyle={style}
      logo={false}
      touchPitch={false}
      touchRotate={false}
      compass={false}
      {...props}
    />
  );
}
