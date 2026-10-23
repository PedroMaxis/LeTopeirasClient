import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/figtree';
import { App } from './App';
import { syncAppearance } from './lib/appearance';
import { watchRendererEvents } from './lib/diagnostics';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

watchRendererEvents();
syncAppearance();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
