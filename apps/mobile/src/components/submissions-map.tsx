import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  type InitialViewState,
  Layer,
  type LngLatBounds,
  type MapRef,
  NativeUserLocation,
} from '@maplibre/maplibre-react-native';
import { type GeoPoint, rootValueFields } from '@wasafili/form-schema';
import { type LocalSubmission } from '@wasafili/sync';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BaseMap, IVORY_COAST } from '@/components/base-map';
import { Button, Card, Icon, STATUS, styles } from '@/components/ui';
import { summary } from '@/app/structure/[id]';
import { useBasemap } from '@/lib/basemap';
import { useOffline } from '@/lib/offline';
import { colors, space } from '@/lib/theme';

const isPoint = (value: unknown): value is GeoPoint =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as GeoPoint).lat === 'number' &&
  typeof (value as GeoPoint).lng === 'number';

interface MapPoint {
  submission: LocalSubmission;
  lngLat: [number, number];
  title: string;
  description: string;
  color: string;
}

/** Cadrage initial sur les points (un seul point : zoom de quartier). */
function initialView(points: MapPoint[]): InitialViewState {
  if (points.length === 0) return { bounds: IVORY_COAST };
  if (points.length === 1) return { center: points[0]!.lngLat, zoom: 14 };
  const lngs = points.map((p) => p.lngLat[0]);
  const lats = points.map((p) => p.lngLat[1]);
  const bounds: LngLatBounds = [
    Math.min(...lngs),
    Math.min(...lats),
    Math.max(...lngs),
    Math.max(...lats),
  ];
  return { bounds, padding: { top: 60, right: 60, bottom: 60, left: 60 } };
}

/**
 * Carte des fiches de l'appareil (P6.1.3), hors ligne : données locales uniquement, sur le fond
 * de carte téléchargé (P3.4.5). Comme sur le serveur, le point d'une fiche est son premier champ
 * géolocalisation renseigné, sinon la position de l'appareil à la saisie. Les points proches se
 * regroupent ; toucher un groupe l'agrandit, toucher un point affiche la fiche.
 */
export function SubmissionsMap({ submissions }: { submissions: LocalSubmission[] }) {
  const { store } = useOffline();
  const basemap = useBasemap();
  const map = useRef<MapRef>(null);
  const camera = useRef<CameraRef>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const points = useMemo(
    () =>
      submissions.flatMap((submission): MapPoint[] => {
        const definition = store.version(submission.versionId)?.definition;
        const field = rootValueFields(definition?.fields ?? []).find(
          (f) => f.type === 'geolocation' && isPoint(submission.data[f.key]),
        );
        const point = field ? (submission.data[field.key] as GeoPoint) : submission.location;
        if (!point) return [];
        const state = definition?.workflow?.states.find((s) => s.key === submission.state);
        return [
          {
            submission,
            lngLat: [point.lng, point.lat],
            title: summary(store, submission),
            description: [state?.label, new Date(submission.createdAt).toLocaleDateString('fr-FR')]
              .filter(Boolean)
              .join(' · '),
            color: state?.color ?? STATUS[submission.status]!.color,
          },
        ];
      }),
    [submissions, store],
  );
  const collection = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: points.map((p) => ({
        type: 'Feature',
        id: p.submission.id,
        geometry: { type: 'Point', coordinates: p.lngLat },
        properties: { id: p.submission.id, color: p.color },
      })),
    }),
    [points],
  );
  // Cadrage calculé au premier affichage seulement : changer de filtre ne déplace pas la vue.
  const [initialViewState] = useState(() => initialView(points));
  const selected = points.find((p) => p.submission.id === selectedId);

  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.muted, { paddingHorizontal: space.lg, paddingBottom: space.sm }]}>
        {points.length} fiche(s) localisée(s) sur {submissions.length}
      </Text>
      <BaseMap ref={map} style={{ flex: 1 }} accessibilityLabel="Carte des fiches">
        <Camera ref={camera} initialViewState={initialViewState} />
        <NativeUserLocation />
        <GeoJSONSource
          id="fiches"
          data={collection}
          cluster
          clusterRadius={48}
          clusterMaxZoom={14}
          onPress={async (event) => {
            const feature = event.nativeEvent.features[0];
            if (!feature || feature.geometry.type !== 'Point') return;
            const center = feature.geometry.coordinates as [number, number];
            if (feature.properties?.['cluster']) {
              const zoom = (await map.current?.getZoom()) ?? 8;
              await camera.current
                ?.setStop({ center, zoom: zoom + 2, duration: 500, easing: 'ease' })
                .catch(() => undefined);
            } else {
              setSelectedId(String(feature.properties?.['id']));
            }
          }}
        >
          <Layer
            id="groupes"
            type="circle"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': colors.primary,
              'circle-opacity': 0.85,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2,
              'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 100, 26],
            }}
          />
          <Layer
            id="groupes-nombre"
            type="symbol"
            filter={['has', 'point_count']}
            layout={{
              'text-field': ['get', 'point_count_abbreviated'],
              'text-font': ['Noto Sans Medium'],
              'text-size': 12,
              'text-allow-overlap': true,
            }}
            paint={{ 'text-color': '#ffffff' }}
          />
          <Layer
            id="fiches-points"
            type="circle"
            filter={['!', ['has', 'point_count']]}
            paint={{
              'circle-color': ['coalesce', ['get', 'color'], colors.primary],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2,
              'circle-radius': ['case', ['==', ['get', 'id'], selectedId ?? ''], 11, 8],
            }}
          />
        </GeoJSONSource>
      </BaseMap>
      {basemap.status !== 'ready' && (
        <Pressable
          onPress={() => router.push('/sync')}
          accessibilityRole="link"
          style={{
            position: 'absolute',
            top: 40,
            left: space.lg,
            right: space.lg,
            backgroundColor: colors.surface,
            padding: space.md,
            borderRadius: 8,
          }}
        >
          <Text style={styles.muted}>
            Fond de carte non téléchargé : touchez ici pour le télécharger (Synchronisation).
          </Text>
        </Pressable>
      )}
      {points.length === 0 && (
        <View
          style={{
            position: 'absolute',
            bottom: space.xl,
            left: space.lg,
            right: space.lg,
            backgroundColor: colors.surface,
            padding: space.md,
            borderRadius: 8,
          }}
        >
          <Text style={styles.muted}>
            Aucune fiche localisée : la position vient d’un champ géolocalisation ou de l’appareil
            au moment de la saisie.
          </Text>
        </View>
      )}
      {selected && (
        <Card
          style={{
            position: 'absolute',
            bottom: space.xl,
            left: space.lg,
            right: space.lg,
            gap: space.sm,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600', color: colors.text }}>{selected.title}</Text>
              {selected.description ? (
                <Text style={styles.muted}>{selected.description}</Text>
              ) : null}
            </View>
            <Pressable
              onPress={() => setSelectedId(null)}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              hitSlop={12}
            >
              <Icon name="x" color={colors.textMuted} />
            </Pressable>
          </View>
          <Button
            title="Ouvrir la fiche"
            onPress={() =>
              router.push({
                pathname: '/form/[structureId]',
                params: {
                  structureId: selected.submission.structureId,
                  id: selected.submission.id,
                },
              })
            }
          />
        </Card>
      )}
    </View>
  );
}
