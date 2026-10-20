// Origen absoluto del backend. En Android (Capacitor) la app se sirve desde
// https://localhost, así que cualquier ruta relativa (/api/..., /uploads/...)
// apuntaría a la propia app en vez de al servidor. Usa siempre estas utilidades.
export const API_BASE = "https://aura.basildo.me";

export const DEFAULT_COVER = `${API_BASE}/uploads/default_cover.jpg`;

/** Convierte una ruta relativa del backend (/uploads/x.jpg) en URL absoluta. */
export const resolveApiUrl = (p?: string | null): string | undefined =>
  !p ? undefined : p.startsWith('/') ? `${API_BASE}${p}` : p;

/**
 * Genera el atributo `srcset` responsivo para portadas.
 * Permite que navegadores móviles y de escritorio descarguen exactamente
 * la resolución necesaria según el tamaño físico de la pantalla y la densidad de píxeles (DPR),
 * sin desperdiciar ancho de banda ni memoria.
 */
export const getResponsiveCoverSrcSet = (url?: string | null): string | undefined => {
  if (!url || typeof url !== 'string') return undefined;
  // Blobs locales de IndexedDB o imágenes en base64 no necesitan redimensión remota
  if (url.startsWith('blob:') || url.startsWith('data:') || url.endsWith('.svg')) return undefined;

  const cleanUrl = url.split('?')[0];
  if (!cleanUrl.includes('/uploads/')) return undefined;

  const absoluteBase = cleanUrl.startsWith('http')
    ? cleanUrl
    : `${API_BASE}${cleanUrl.startsWith('/') ? '' : '/'}${cleanUrl}`;

  return [
    `${absoluteBase}?w=300 300w`,
    `${absoluteBase}?w=600 600w`,
    `${absoluteBase}?w=900 900w`,
    `${absoluteBase}?w=1200 1200w`
  ].join(', ');
};

/**
 * Devuelve una URL de miniatura optimizada con el ancho indicado (ej. para mini-reproductores o iconos)
 */
export const getThumbnailUrl = (url?: string | null, width = 300): string | undefined => {
  if (!url || typeof url !== 'string') return undefined;
  if (url.startsWith('blob:') || url.startsWith('data:') || url.endsWith('.svg')) return url;

  const cleanUrl = url.split('?')[0];
  if (!cleanUrl.includes('/uploads/')) return url;

  const absoluteBase = cleanUrl.startsWith('http')
    ? cleanUrl
    : `${API_BASE}${cleanUrl.startsWith('/') ? '' : '/'}${cleanUrl}`;

  return `${absoluteBase}?w=${width}`;
};
