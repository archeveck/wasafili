import { defaultLocale, resources } from '@tesserax/i18n';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

void i18n.use(initReactI18next).init({
  resources,
  lng: defaultLocale,
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
});

export default i18n;
