import { dayIn } from '@tesserax/form-engine';
import { type LocalTask } from '@tesserax/sync';
import { router } from 'expo-router';
import { Alert, Pressable, SectionList, Text, View } from 'react-native';
import { SyncBar } from '@/components/sync-bar';
import { Badge, Empty, styles } from '@/components/ui';
import { useOffline } from '@/lib/offline';
import { colors, font, radius, space } from '@/lib/theme';

const STATUS: Record<LocalTask['status'], { label: string; color: string }> = {
  todo: { label: 'À faire', color: colors.primary },
  in_progress: { label: 'En cours', color: colors.warning },
  done: { label: 'Faite', color: colors.success },
  cancelled: { label: 'Annulée', color: colors.textMuted },
};

function TaskRow({
  task,
  timeZone,
  structure,
}: {
  task: LocalTask;
  timeZone: string;
  structure?: string;
}) {
  const time = new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' });
  const open = () => {
    if (task.submissionId) {
      router.push({
        pathname: '/form/[structureId]',
        params: { structureId: task.structureId, id: task.submissionId },
      });
      return;
    }
    if (task.status === 'cancelled') return;
    if (!structure) {
      Alert.alert(
        'Formulaire indisponible',
        'Synchronisez l’appareil pour télécharger ce formulaire.',
      );
      return;
    }
    // Fiche pré-remplie depuis la tâche ; la tâche est close à l'envoi de la fiche.
    router.push({
      pathname: '/form/[structureId]',
      params: {
        structureId: task.structureId,
        taskId: task.id,
        prefill: JSON.stringify(task.prefill),
      },
    });
  };
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${task.title}, ${time.format(new Date(task.startAt))}, ${STATUS[task.status].label}`}
      style={({ pressed }) => ({
        marginHorizontal: space.lg,
        marginBottom: space.sm,
        padding: space.md,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderLeftWidth: 4,
        borderLeftColor: STATUS[task.status].color,
        opacity: pressed ? 0.8 : task.status === 'cancelled' ? 0.5 : 1,
        gap: space.xs,
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <Text style={{ fontWeight: '700', fontSize: font.md, flexShrink: 1 }}>
          {time.format(new Date(task.startAt))} · {task.title}
        </Text>
        <Badge label={STATUS[task.status].label} color={STATUS[task.status].color} />
      </View>
      {structure ? <Text style={styles.muted}>{structure}</Text> : null}
      {task.locationLabel ? <Text style={styles.muted}>📍 {task.locationLabel}</Text> : null}
      {task.description ? <Text>{task.description}</Text> : null}
    </Pressable>
  );
}

/** Agenda du technicien (P4.4.5) : tâches assignées, disponibles hors ligne. */
export default function Tasks() {
  const { store, settings } = useOffline();
  const timeZone = (settings?.['timeZone'] as string | undefined) ?? 'Africa/Abidjan';
  const today = dayIn(new Date(), timeZone);
  const day = (iso: string) => dayIn(new Date(iso), timeZone);
  const names = new Map(store.structures().map((s) => [s.id, s.name]));
  const tasks = store.tasks();
  const open = (t: LocalTask) => t.status === 'todo' || t.status === 'in_progress';
  const label = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const sections = [
    { title: 'En retard', data: tasks.filter((t) => open(t) && day(t.startAt) < today) },
    { title: 'Aujourd’hui', data: tasks.filter((t) => day(t.startAt) === today) },
    ...[...new Set(tasks.filter((t) => day(t.startAt) > today).map((t) => day(t.startAt)))].map(
      (d) => ({
        title: label.format(new Date(`${d}T00:00:00Z`)),
        data: tasks.filter((t) => day(t.startAt) === d),
      }),
    ),
  ].filter((section) => section.data.length > 0);

  return (
    <View style={{ flex: 1 }}>
      <SyncBar />
      <SectionList
        sections={sections}
        keyExtractor={(task) => task.id}
        contentContainerStyle={{ paddingVertical: space.md }}
        renderSectionHeader={({ section }) => (
          <Text
            style={{
              paddingHorizontal: space.lg,
              paddingVertical: space.sm,
              fontWeight: '700',
              color: section.title === 'En retard' ? colors.danger : colors.textMuted,
              textTransform: 'capitalize',
            }}
          >
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => {
          const structure = names.get(item.structureId);
          return <TaskRow task={item} timeZone={timeZone} {...(structure ? { structure } : {})} />;
        }}
        ListEmptyComponent={
          <Empty title="Aucune tâche">Les tâches planifiées pour vous apparaîtront ici.</Empty>
        }
      />
    </View>
  );
}
