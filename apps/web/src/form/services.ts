import { type FieldServices } from '@wasafili/form-renderer';
import { type AppClient } from '@wasafili/sdk';

/** Services des champs (référentiels, fichiers, utilisateurs) branchés sur l'API de l'instance. */
export function fieldServices(api: AppClient): FieldServices {
  return {
    listItems: async (listId, { parentId, level, q }) =>
      (
        await api.lists.items(listId, {
          perPage: 100,
          ...(parentId ? { parentId } : {}),
          ...(level !== undefined ? { level } : {}),
          ...(q ? { q } : {}),
        })
      ).data,
    uploadFile: (file) => api.files.upload(file),
    fileUrl: async (fileId) => {
      const file = await api.files.get(fileId);
      return { url: file.url, thumbnailUrl: file.thumbnailUrl };
    },
    users: async () =>
      (await api.users.list({ perPage: 100 }).catch(() => ({ data: [] }))).data.map((member) => ({
        id: member.id,
        label: `${member.firstName} ${member.lastName}`,
      })),
  };
}
