import { layers, namedFlavor } from '@protomaps/basemaps';
import {
  addProtocol,
  type GeoJSONSource,
  LngLatBounds,
  type LngLatBoundsLike,
  Map as MapLibre,
  NavigationControl,
  setWorkerUrl,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Worker de MapLibre construit par Vite : par défaut, MapLibre le cherche à côté de son module,
// où ni le pré-bundling de développement ni le build ne le placent.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import { useEffect, useRef, useState } from 'react';

/** Fond de carte auto-hébergé (infra/maps/fetch-basemap.sh), servi sous la même origine. */
const BASEMAP_PATH = '/tiles/basemap.pmtiles';
/** Vue par défaut : Côte d'Ivoire. */
const DEFAULT_BOUNDS: LngLatBoundsLike = [
  [-8.6, 4.3],
  [-2.5, 10.7],
];

let protocolRegistered = false;
let basemapCheck: Promise<boolean> | undefined;

/** Le fond de carte est facultatif : sans lui, les points s'affichent sur un fond neutre. */
function basemapAvailable(): Promise<boolean> {
  basemapCheck ??= fetch(BASEMAP_PATH, { method: 'HEAD' })
    .then((res) => res.ok && !res.headers.get('content-type')?.includes('text/html'))
    .catch(() => false);
  return basemapCheck;
}

function mapStyle(withBasemap: boolean): StyleSpecification {
  const origin = window.location.origin;
  return {
    version: 8,
    glyphs: `${origin}/maps/fonts/{fontstack}/{range}.pbf`,
    sources: withBasemap
      ? {
          protomaps: {
            type: 'vector',
            url: `pmtiles://${origin}${BASEMAP_PATH}`,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>',
          },
        }
      : {},
    layers: withBasemap
      ? layers('protomaps', namedFlavor('light'), { lang: 'fr' })
      : [{ id: 'fond', type: 'background', paint: { 'background-color': '#eef0ec' } }],
  };
}

export interface PointFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { id: string; color?: string } & Record<string, unknown>;
}

/**
 * Carte de points (MapLibre + PMTiles, ADR 0010) : regroupement à faible zoom, couleur par
 * point (`properties.color`), sélection au clic. Le cadrage suit les données au premier
 * affichage et à chaque changement de jeu (`fitKey`).
 */
export function FeatureMap({
  features,
  fitKey,
  selectedId,
  onSelect,
  label,
  className,
}: {
  features: PointFeature[];
  /** Change quand les filtres changent : la carte se recadre sur les nouveaux points. */
  fitKey: string;
  selectedId?: string | null;
  onSelect: (id: string | null) => void;
  label: string;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const [ready, setReady] = useState(false);
  const [withBasemap, setWithBasemap] = useState<boolean | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    void basemapAvailable().then((available) => {
      if (cancelled || !container.current) return;
      if (!protocolRegistered) {
        setWorkerUrl(workerUrl);
        addProtocol('pmtiles', new Protocol().tile);
        protocolRegistered = true;
      }
      setWithBasemap(available);
      const instance = new MapLibre({
        container: container.current,
        style: mapStyle(available),
        bounds: DEFAULT_BOUNDS,
        attributionControl: { compact: true },
      });
      instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
      // Icônes du fond non fournies (seules les polices sont embarquées) : image vide.
      instance.setMissingStyleImageResolver((id) => {
        if (!instance.hasImage(id)) {
          instance.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
        }
      });
      instance.on('load', () => {
        instance.addSource('points', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          // Identifiant texte des fiches : nécessaire à l'état « sélectionné » d'un point.
          promoteId: 'id',
          cluster: true,
          clusterRadius: 48,
          clusterMaxZoom: 14,
        });
        instance.addLayer({
          id: 'groupes',
          type: 'circle',
          source: 'points',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#1f6f5c',
            'circle-opacity': 0.85,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 100, 26, 1000, 32],
          },
        });
        instance.addLayer({
          id: 'groupes-nombre',
          type: 'symbol',
          source: 'points',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Noto Sans Medium'],
            'text-size': 12,
          },
          paint: { 'text-color': '#ffffff' },
        });
        instance.addLayer({
          id: 'points',
          type: 'circle',
          source: 'points',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': ['coalesce', ['get', 'color'], '#1f6f5c'],
            'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 9, 6],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
        instance.on('click', 'groupes', async (event) => {
          const cluster = event.features?.[0];
          if (!cluster) return;
          const source = instance.getSource<GeoJSONSource>('points')!;
          const zoom = await source.getClusterExpansionZoom(cluster.properties['cluster_id']);
          const [lng, lat] = (cluster.geometry as unknown as { coordinates: [number, number] })
            .coordinates;
          instance.easeTo({ center: [lng, lat], zoom });
        });
        instance.on('click', 'points', (event) => {
          const id = event.features?.[0]?.properties['id'];
          if (typeof id === 'string') onSelectRef.current(id);
        });
        instance.on('click', (event) => {
          const hit = instance.queryRenderedFeatures(event.point, {
            layers: ['points', 'groupes'],
          });
          if (hit.length === 0) onSelectRef.current(null);
        });
        for (const layer of ['points', 'groupes']) {
          instance.on('mouseenter', layer, () => (instance.getCanvas().style.cursor = 'pointer'));
          instance.on('mouseleave', layer, () => (instance.getCanvas().style.cursor = ''));
        }
        setReady(true);
      });
      map.current = instance;
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      setReady(false);
    };
  }, []);

  // Données : mise à jour de la source, recadrage quand le jeu de points change.
  const lastFit = useRef<string | null>(null);
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    instance
      .getSource<GeoJSONSource>('points')!
      .setData({ type: 'FeatureCollection', features } as Parameters<GeoJSONSource['setData']>[0]);
    if (lastFit.current === fitKey || features.length === 0) return;
    lastFit.current = fitKey;
    const bounds = new LngLatBounds();
    for (const feature of features) bounds.extend(feature.geometry.coordinates);
    instance.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
  }, [ready, features, fitKey]);

  // Point sélectionné : mis en avant (état de l'entité, identifiant numérique non requis).
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    instance.removeFeatureState({ source: 'points' });
    if (selectedId)
      instance.setFeatureState({ source: 'points', id: selectedId }, { selected: true });
  }, [ready, selectedId, features]);

  return (
    <div
      className={className ?? 'relative h-[560px] overflow-hidden rounded-lg border border-border'}
    >
      {/* MapLibre impose `position: relative` à son conteneur : taille explicite. */}
      <div ref={container} className="h-full w-full" role="region" aria-label={label} />
      {withBasemap === false && (
        <p className="absolute bottom-2 left-2 rounded bg-surface/90 px-2 py-1 text-xs text-muted shadow">
          Fond de carte non installé (infra/maps/fetch-basemap.sh)
        </p>
      )}
    </div>
  );
}
