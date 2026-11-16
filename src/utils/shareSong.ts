import { Capacitor } from '@capacitor/core';
import AuraMedia from '../plugins/auraMedia';
import { type Song } from '../constants';
import { hapticImpact, hapticSuccess } from './haptics';

const SHARE_BASE_URL = 'https://aura.basildo.me';

export interface ShareToastState {
  uid: number;
  message: string;
  subtitle?: string;
}

let activeShareSong: Song | null = null;
let shareToastState: ShareToastState | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function subscribeShareStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getActiveShareSongSnapshot(): Song | null {
  return activeShareSong;
}

export function getShareToastSnapshot(): ShareToastState | null {
  return shareToastState;
}

export function closeShareSongModal() {
  activeShareSong = null;
  notify();
}

export function showShareToast(message: string, subtitle?: string, durationMs = 3200) {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  shareToastState = {
    uid: Date.now() + Math.random(),
    message,
    subtitle,
  };
  notify();
  toastTimer = setTimeout(() => {
    shareToastState = null;
    toastTimer = null;
    notify();
  }, durationMs);
}

export function isMobileShareEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  if (Capacitor.isNativePlatform()) return true;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return true;
  }
  return window.innerWidth < 640;
}

export function getSongShareUrl(song: Song): string {
  return `${SHARE_BASE_URL}/?track=${encodeURIComponent(String(song.id))}`;
}

export function getSongShareText(song: Song): string {
  const url = getSongShareUrl(song);
  return `🎵 Escucha "${song.title}" de ${song.artist} en AURA:\n${url}`;
}

export async function copySongShareLink(song: Song): Promise<boolean> {
  const url = getSongShareUrl(song);
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    void hapticSuccess();
    showShareToast(
      `Enlace copiado al portapapeles`,
      `Listo para compartir "${song.title}" — ${song.artist}`
    );
    return true;
  } catch {
    showShareToast('No se pudo copiar automáticamente', url);
    return false;
  }
}

export async function openShareDeepLink(url: string) {
  if (Capacitor.isNativePlatform() && typeof AuraMedia.openExternalUrl === 'function') {
    try {
      await AuraMedia.openExternalUrl({ url });
      return;
    } catch {}
  }

  if (typeof (window as any).__TAURI_OPEN_URL__ === 'function') {
    try {
      (window as any).__TAURI_OPEN_URL__(url);
      return;
    } catch {}
  }

  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function triggerNativeSystemShare(song: Song): Promise<boolean> {
  const url = getSongShareUrl(song);
  const text = `🎵 Escucha "${song.title}" de ${song.artist} en AURA`;
  const fullText = `${text}\n${url}`;

  if (Capacitor.isNativePlatform() && typeof (AuraMedia as any).shareText === 'function') {
    try {
      await (AuraMedia as any).shareText({
        title: `${song.title} — ${song.artist}`,
        text: fullText,
      });
      return true;
    } catch {}
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: `${song.title} — ${song.artist}`,
        text,
        url,
      });
      return true;
    } catch (err: any) {
      if (err?.name === 'AbortError') return true;
    }
  }

  return false;
}

/**
 * En PC / Web escritorio: solo copia directamente el enlace para escuchar la canción.
 * En Móvil: abre el selector de aplicaciones (WhatsApp, Instagram, Telegram, etc.).
 */
export async function triggerShareSong(song: Song, forceMobileSheet?: boolean) {
  void hapticImpact('light');
  if (!forceMobileSheet && !isMobileShareEnvironment()) {
    await copySongShareLink(song);
    return;
  }

  activeShareSong = song;
  notify();
}
