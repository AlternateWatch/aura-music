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

// Manejo de errores de carga de módulos (ChunkLoadError).
// Después de un despliegue, el navegador puede intentar cargar un trozo de JS antiguo (404).
// Al detectar este fallo, forzamos la recarga de la página para obtener la versión actual.
window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason;
  if (
    error instanceof TypeError &&
    (error.message.includes('Failed to fetch dynamically imported module') ||
     error.message.includes('Loading chunk'))
  ) {
    console.warn('Detectado error de carga de módulo (posible nueva versión desplegada). Recargando página...');
    window.location.reload();
  }
});

// Registro del Service Worker que cachea el audio en reproducción y
// precarga la siguiente pista (ver public/sw.js). No bloquea el arranque.
registerAudioCacheSW();
