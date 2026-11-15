import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startAutosave } from './lib/persist';
import { initCloud } from './lib/cloud';
import { initTheme } from './lib/theme';
import App from './App';
import './styles.css';

initTheme();
startAutosave();
void initCloud(); // accounts and cloud library, when the server has them configured

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
