import { useState, useEffect } from "react";

const urlCache = new Map<string, string>();

const API_ORIGIN = "https://aura.basildo.me";

// Misma lógica de resolución que usa el hook, expuesta como función suelta
// para poder precargar (con new Image()) una URL fuera de un componente
// React — por ejemplo, antes de aplicar la carátula del hero banner.
export async function resolveFileUrl(url: string): Promise<string | undefined> {
  if (!url) return undefined;

  // Fast path: if it's already a full URL, return it immediately
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("blob:") ||
    url.startsWith("data:")
  ) {
    return url;
  }

  // Standard path: handle relative uploads
  if (url.startsWith("/uploads/")) {
    return `${API_ORIGIN}${url}`;
  }

  return url;
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