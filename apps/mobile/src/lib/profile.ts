import { store } from './offline';

export interface Profile {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  roles: string[];
}

/** Profil dans l'instance, mémorisé pour les conditions par rôle hors ligne. */
export const profile = () => store.getMeta<Profile>('profile');
export const saveProfile = (value: Profile) => store.setMeta('profile', value);
