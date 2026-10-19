import { useState, useEffect } from "react";
import { getOfflineBlobUrl, subscribeOfflineStore } from "../utils/offlineDb";

const API_ORIGIN = "https://aura.basildo.me";

// Misma lógica de resolución que usa el hook, expuesta como función suelta
// para poder precargar (con new Image() o prefetchAudio) una URL fuera de
// un componente React. Prioriza el almacenamiento offline en IndexedDB (Dexie).
export async function resolveFileUrl(url: string): Promise<string | undefined> {
  if (!url) return undefined;

  if (url.startsWith("blob:") || url.startsWith("data:")) {
    return url;
  }

  // 1. Comprobar primero si está descargada en IndexedDB para reproducción offline instantánea
  const offlineBlobUrl = await getOfflineBlobUrl(url);
  if (offlineBlobUrl) {
    return offlineBlobUrl;
  }

  // 2. Si ya es una URL absoluta
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  // 3. Compatibilidad con rutas antiguas /uploads/
  if (url.startsWith("/uploads/")) {
    return `${API_ORIGIN}${url}`;
  }

  return url;
}

export function useFileUrl(url: string | undefined | null): string | undefined {
  const [resolvedUrl, setResolvedUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!url) {
      setResolvedUrl(undefined);
      return;
    }

    let isMounted = true;

    const update = () => {
      resolveFileUrl(url).then((resolved) => {
        if (isMounted) setResolvedUrl(resolved);
      });
    };

    update();
    const unsubscribe = subscribeOfflineStore(update);

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [url]);

  return resolvedUrl;
}