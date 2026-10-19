import { type GeoPoint, rootValueFields } from '@tesserax/form-schema';
import { type LocalSubmission } from '@tesserax/sync';
import { router } from 'expo-router';
import { useMemo, useRef } from 'react';
import { Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { STATUS, styles } from '@/components/ui';
import { summary } from '@/app/structure/[id]';
import { useOffline } from '@/lib/offline';
import { colors, space } from '@/lib/theme';

/** Vue par défaut : Abidjan. */
const ABIDJAN = { latitude: 5.33, longitude: -4.03, latitudeDelta: 0.25, longitudeDelta: 0.25 };

const isPoint = (value: unknown): value is GeoPoint =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as GeoPoint).lat === 'number' &&
  typeof (value as GeoPoint).lng === 'number';

/**
 * Carte des fiches de l'appareil (P6.1.3), hors ligne : données locales uniquement. Comme
 * sur le serveur, le point d'une fiche est son premier champ géolocalisation renseigné,
 * sinon la position de l'appareil à la saisie. Toucher la bulle d'un repère ouvre la fiche.
 */
export function SubmissionsMap({ submissions }: { submissions: LocalSubmission[] }) {
  const { store } = useOffline();
  const map = useRef<MapView>(null);
  const points = useMemo(
    () =>
      submissions.flatMap((submission) => {
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
            coordinate: { latitude: point.lat, longitude: point.lng },
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

  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.muted, { paddingHorizontal: space.lg, paddingBottom: space.sm }]}>
        {points.length} fiche(s) localisée(s) sur {submissions.length}
      </Text>
      <MapView
        ref={map}
        style={{ flex: 1 }}
        initialRegion={ABIDJAN}
        showsUserLocation
        accessibilityLabel="Carte des fiches"
        onMapReady={() => {
          if (points.length > 0) {
            map.current?.fitToCoordinates(
              points.map((p) => p.coordinate),
              { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: false },
            );
          }
        }}
      >
        {points.map((point) => (
          <Marker
            key={point.submission.id}
            coordinate={point.coordinate}
            title={point.title}
            description={point.description}
            pinColor={point.color}
            onCalloutPress={() =>
              router.push({
                pathname: '/form/[structureId]',
                params: { structureId: point.submission.structureId, id: point.submission.id },
              })
            }
          />
        ))}
      </MapView>
      {points.length === 0 && (
        <View
          style={{
            position: 'absolute',
            top: 48,
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
    </View>
  );
}
