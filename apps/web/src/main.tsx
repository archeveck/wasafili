import { resources } from '@tesserax/i18n';
import { tokens } from '@tesserax/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Page d'attente : le back-office (TanStack Router/Query, shadcn/ui) arrive en Phase 2 (P2.1).
function App() {
  return (
    <main
      style={{
        fontFamily: tokens.font.family,
        color: tokens.color.text,
        background: tokens.color.background,
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <h1 style={{ color: tokens.color.primary }}>{resources.fr.translation.app.name}</h1>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
