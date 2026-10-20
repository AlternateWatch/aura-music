// Origen absoluto del backend. En Android (Capacitor) la app se sirve desde
// https://localhost, así que cualquier ruta relativa (/api/..., /uploads/...)
// apuntaría a la propia app en vez de al servidor. Usa siempre estas utilidades.
export const API_BASE = "https://aura.basildo.me";

export const DEFAULT_COVER = `${API_BASE}/uploads/default-cover.jpg`;

/** Convierte una ruta relativa del backend (/uploads/x.jpg) en URL absoluta. */
export const resolveApiUrl = (p?: string | null): string | undefined =>
  !p ? undefined : p.startsWith('/') ? `${API_BASE}${p}` : p;
