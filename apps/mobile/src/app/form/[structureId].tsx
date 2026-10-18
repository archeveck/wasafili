import { Stack, useLocalSearchParams } from 'expo-router';
import { FormScreen } from '@/form/form-screen';
import { store } from '@/lib/offline';

export default function FormRoute() {
  const { structureId, id, prefill, taskId } = useLocalSearchParams<{
    structureId: string;
    id?: string;
    prefill?: string;
    taskId?: string;
  }>();
  return (
    <>
      <Stack.Screen options={{ title: store.structure(structureId)?.name ?? 'Saisie' }} />
      <FormScreen
        structureId={structureId}
        {...(id ? { submissionId: id } : {})}
        {...(prefill ? { prefill: JSON.parse(prefill) as Record<string, unknown> } : {})}
        {...(taskId ? { taskId } : {})}
      />
    </>
  );
}
