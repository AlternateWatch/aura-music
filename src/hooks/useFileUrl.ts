import { useState, useEffect } from "react";
import { getOfflineBlobUrl, getCachedOfflineBlobUrl, subscribeOfflineStore } from "../utils/offlineDb";

const API_ORIGIN = "https://aura.basildo.me";
const AUDIO_EXT_RE = /\.(flac|mp3|wav|m4a|ogg|aac|opus)(\?.*)?$/i;

function getEffectiveAudioQuality(): "original" | "high" | "low" {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("aura_streaming_quality") || "original" : "original";
    if (raw === "low" || raw === "high") return raw;
    if (raw === "auto" && typeof navigator !== "undefined") {
      const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      if (conn) {
        if (conn.saveData) return "low";
        if (conn.type === "cellular") return "low";
        if (conn.effectiveType === "slow-2g" || conn.effectiveType === "2g" || conn.effectiveType === "3g") return "low";
      }
    }
  } catch {}
  return "original";
}

function applyAudioQualityParam(url: string): string {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return url;
  if (!AUDIO_EXT_RE.test(url)) return url;
  const q = getEffectiveAudioQuality();
  if (q === "original") return url;
  if (url.includes("quality=")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}quality=${q}`;
}

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
    return applyAudioQualityParam(url);
  }

  // 3. Compatibilidad con rutas antiguas /uploads/
  if (url.startsWith("/uploads/")) {
    return applyAudioQualityParam(`${API_ORIGIN}${url}`);
  }

  return applyAudioQualityParam(url);
}

function resolveSyncFallbackUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const cachedBlob = getCachedOfflineBlobUrl(url);
  if (cachedBlob) return cachedBlob;
  if (url.startsWith("/uploads/")) return applyAudioQualityParam(`${API_ORIGIN}${url}`);
  return applyAudioQualityParam(url);
}

export function useFileUrl(url: string | undefined | null, _isThumb?: boolean): string | undefined {
  const [state, setState] = useState<{ inputUrl: string | undefined | null; resolvedUrl: string | undefined }>(() => ({
    inputUrl: url,
    resolvedUrl: resolveSyncFallbackUrl(url),
  }));

  // Si la url cambia durante el render, actualizamos síncronamente el estado
  // para que ningún hook hijo (como useAudioEngine) reciba una URL obsoleta de la canción previa
  let effectiveResolvedUrl = state.resolvedUrl;
  if (state.inputUrl !== url) {
    effectiveResolvedUrl = resolveSyncFallbackUrl(url);
    setState({
      inputUrl: url,
      resolvedUrl: effectiveResolvedUrl,
    });
  }

  useEffect(() => {
    if (!url) {
      return;
    }

    let isMounted = true;

    const update = () => {
      resolveFileUrl(url).then((resolved) => {
        if (isMounted && resolved) {
          setState((prev) => (prev.inputUrl === url && prev.resolvedUrl !== resolved ? { inputUrl: url, resolvedUrl: resolved } : prev));
        }
      });
    };

    update();
    const unsubscribe = subscribeOfflineStore(update);
    const onQualityChanged = () => update();
    if (typeof window !== "undefined") {
      window.addEventListener("aura:streaming-quality-changed", onQualityChanged);
    }

    return () => {
      isMounted = false;
      unsubscribe();
      if (typeof window !== "undefined") {
        window.removeEventListener("aura:streaming-quality-changed", onQualityChanged);
      }
    };
  }, [url]);

  return effectiveResolvedUrl;
}
