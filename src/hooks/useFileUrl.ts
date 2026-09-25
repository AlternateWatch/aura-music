import { useState, useEffect } from "react";
import { firebaseService } from "../services/firebaseService";

const urlCache = new Map<string, string>();

const API_ORIGIN = "https://aura.basildo.me";

// Misma lógica de resolución que usa el hook, expuesta como función suelta
// para poder precargar (con new Image()) una URL fuera de un componente
// React — por ejemplo, antes de aplicar la carátula del hero banner.
export async function resolveFileUrl(url: string): Promise<string | undefined> {
  if (!url) return undefined;

  if (!url.startsWith("firestore-file://")) {
    if (url.startsWith("/uploads/")) {
      return `${API_ORIGIN}${url}`;
    }
    return url;
  }

  if (urlCache.has(url)) {
    return urlCache.get(url);
  }

  const resolved = await firebaseService.getFileUrl(url);
  if (resolved) {
    urlCache.set(url, resolved);
  }
  return resolved || undefined;
}

export function useFileUrl(url: string | undefined): string | undefined {
  const [resolvedUrl, setResolvedUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!url) {
      setResolvedUrl(undefined);
      return;
    }

    let isMounted = true;

    resolveFileUrl(url).then((resolved) => {
      if (isMounted) setResolvedUrl(resolved);
    });

    return () => {
      isMounted = false;
    };
  }, [url]);

  return resolvedUrl;
}