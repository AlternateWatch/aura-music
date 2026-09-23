import { useState, useEffect } from "react";
import { firebaseService } from "../services/firebaseService";

const urlCache = new Map<string, string>();

const API_ORIGIN = "https://aura.basildo.me";

export function useFileUrl(url: string | undefined): string | undefined {
  const [resolvedUrl, setResolvedUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!url) {
      setResolvedUrl(undefined);
      return;
    }

    if (!url.startsWith("firestore-file://")) {
      console.log("useFileUrl:", url);

      if (url.startsWith("/uploads/")) {
        const finalUrl = `${API_ORIGIN}${url}`;

        console.log("URL final:", finalUrl);

        setResolvedUrl(finalUrl);
      } else {
        setResolvedUrl(url);
      }

      return;
    }

    if (urlCache.has(url)) {
      setResolvedUrl(urlCache.get(url));
      return;
    }

    let isMounted = true;

    firebaseService.getFileUrl(url).then((resolved) => {
      if (isMounted && resolved) {
        urlCache.set(url, resolved);
        setResolvedUrl(resolved);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [url]);

  return resolvedUrl;
}