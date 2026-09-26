import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource-variable/bricolage-grotesque';
import './index.css';
import Root from './auth/Root';
import { initPwa } from './pwa';

initPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
