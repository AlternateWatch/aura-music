import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerAudioCacheSW } from './utils/audioCache';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Registro del Service Worker que cachea el audio en reproducción y
// precarga la siguiente pista (ver public/sw.js). No bloquea el arranque.
registerAudioCacheSW();
