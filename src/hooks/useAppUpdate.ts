import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { API_BASE } from '../utils/api';

export const CURRENT_APP_VERSION = "1.0.10";

export interface AppUpdateHistoryItem {
  version: string;
  versionCode?: number;
  notes: string;
  publishedAt?: string;
}

export interface AppUpdateInfo {
  platform: string;
  latestVersion: string;
  versionCode?: number;
  releaseNotes: string;
  downloadUrl: string;
  mandatory?: boolean;
  publishedAt?: string;
  history?: AppUpdateHistoryItem[];
}

/**
 * Compara dos versiones semánticas ("1.2.6" vs "1.2.5").
 * Devuelve true si latest es estrictamente mayor que current.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  if (!latest || !current) return false;
  const pLatest = latest.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const pCurrent = current.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pLatest.length, pCurrent.length); i++) {
    const l = pLatest[i] || 0;
    const c = pCurrent[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

/**
 * Devuelve únicamente las notas de los parches entre la versión actual instalada
 * y la versión más reciente.
 * - Si es 1 versión de salto (ej. 1.0.4 -> 1.0.5), devuelve SOLO las notas de 1.0.5 sin acumular anteriores.
 * - Si salta varias versiones (ej. 1.0.3 -> 1.0.5), agrupa las notas de 1.0.5 y 1.0.4.
 */
export function getDiffReleaseNotes(
  updateInfo: AppUpdateInfo | null,
  currentVersion: string
): { notes: string; versionsCount: number; isMultiVersion: boolean } {
  if (!updateInfo) return { notes: '', versionsCount: 0, isMultiVersion: false };

  const history = updateInfo.history;
  if (Array.isArray(history) && history.length > 0) {
    // Filtrar solo aquellas versiones en el historial que sean estrictamente más nuevas que la instalada
    const relevant = history
      .filter(item => isNewerVersion(item.version, currentVersion))
      .sort((a, b) => (isNewerVersion(a.version, b.version) ? -1 : 1));

    if (relevant.length === 1) {
      return {
        notes: relevant[0].notes,
        versionsCount: 1,
        isMultiVersion: false
      };
    } else if (relevant.length > 1) {
      const formatted = relevant
        .map(item => `✨ Versión v${item.version}:\n${item.notes}`)
        .join('\n\n');
      return {
        notes: formatted,
        versionsCount: relevant.length,
        isMultiVersion: true
      };
    }
  }

  // Fallback si no hay historial
  return {
    notes: updateInfo.releaseNotes || 'Mejoras de rendimiento y estabilidad.',
    versionsCount: 1,
    isMultiVersion: false
  };
}

export function useAppUpdate() {
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>(CURRENT_APP_VERSION);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [isWhatsNewModal, setIsWhatsNewModal] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);

  // Obtener la versión nativa real instalada en Android si estamos en Capacitor
  useEffect(() => {
    let isMounted = true;
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.getInfo()
        .then(info => {
          if (isMounted && info?.version) {
            setCurrentVersion(info.version);
          }
        })
        .catch(() => {});
    }
    return () => { isMounted = false; };
  }, []);

  // 1. Detección automática al arrancar:
  // Si acabas de actualizar/instalar una versión y es la primera vez que la abres,
  // mostrar automáticamente las novedades de dicha versión (What's New modal).
  useEffect(() => {
    const checkFirstLaunchOrUpdate = async () => {
      let installedVer = currentVersion;
      if (Capacitor.isNativePlatform()) {
        try {
          const info = await CapacitorApp.getInfo();
          if (info?.version) {
            installedVer = info.version;
            setCurrentVersion(installedVer);
          }
        } catch {}
      }

      const lastSeen = localStorage.getItem("aura_last_seen_version");
      if (lastSeen !== installedVer) {
        // Primera vez abriendo esta versión
        try {
          const res = await fetch(`${API_BASE}/api/app/version`, {
            cache: 'no-store',
            headers: { 'Accept': 'application/json' }
          });
          if (res.ok) {
            let data: AppUpdateInfo = await res.json();
      try {
        const staticRes = await fetch(`${API_BASE}/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (staticRes.ok) {
          const staticData = await staticRes.json();
          if (isNewerVersion(staticData.latestVersion, data.latestVersion)) {
            data = staticData;
          }
        }
      } catch (e) {}
            // Solo mostrar novedades de la instalada si no hay una actualización mayor pendiente
            if (!isNewerVersion(data.latestVersion, installedVer)) {
              setUpdateInfo(data);
              setIsWhatsNewModal(true);
              setIsUpdateModalOpen(true);
              return;
            }
          }
        } catch {}
      }
    };

    const timer = setTimeout(checkFirstLaunchOrUpdate, 1200);
    return () => clearTimeout(timer);
  }, []);

  const checkForUpdates = useCallback(async (isManual = false) => {
    setIsChecking(true);
    setCheckMessage(null);
    try {
      let installedVer = currentVersion;
      if (Capacitor.isNativePlatform()) {
        try {
          const info = await CapacitorApp.getInfo();
          if (info?.version) {
            installedVer = info.version;
            setCurrentVersion(installedVer);
          }
        } catch {}
      }

      const url = new URL(`${API_BASE}/api/app/version`);
      if (installedVer) {
        url.searchParams.set('current', installedVer);
      }

      const res = await fetch(url.toString(), {
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) {
        if (isManual) setCheckMessage("No se pudo comprobar la versión.");
        return;
      }

      const data: AppUpdateInfo = await res.json();
      const hasNewVersion = isNewerVersion(data.latestVersion, installedVer);

      if (hasNewVersion) {
        setUpdateInfo(data);
        setIsWhatsNewModal(false);
        const dismissedKey = `aura_dismissed_update_${data.latestVersion}`;
        const wasDismissed = sessionStorage.getItem(dismissedKey) === 'true';

        // Si es manual o no ha sido descartada en esta sesión (o es obligatoria), mostrar modal
        if (isManual || !wasDismissed || data.mandatory) {
          setIsUpdateModalOpen(true);
        }
      } else {
        if (isManual) {
          setCheckMessage(`¡Ya tienes la versión más reciente (v${installedVer})!`);
        }
      }
    } catch (err: any) {
      if (isManual) {
        setCheckMessage("Error al conectar con el servidor de actualizaciones.");
      }
    } finally {
      setIsChecking(false);
    }
  }, [currentVersion]);

  // Comprobar automáticamente actualizaciones al arrancar en Android nativo (después de 3s)
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      return;
    }

    const timer = setTimeout(() => {
      // Solo buscar updates si no está abierto el modal de What's New
      if (!isWhatsNewModal) {
        checkForUpdates(false);
      }
    }, 3200);

    return () => clearTimeout(timer);
  }, [checkForUpdates, isWhatsNewModal]);

  const openWhatsNewModal = useCallback(async () => {
    setIsChecking(true);
    try {
      const res = await fetch(`${API_BASE}/api/app/version`, {
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const data: AppUpdateInfo = await res.json();
        setUpdateInfo(data);
        setIsWhatsNewModal(true);
        setIsUpdateModalOpen(true);
      }
    } catch {}
    finally {
      setIsChecking(false);
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    if (isWhatsNewModal) {
      localStorage.setItem('aura_last_seen_version', currentVersion);
      setIsWhatsNewModal(false);
    } else if (updateInfo) {
      sessionStorage.setItem(`aura_dismissed_update_${updateInfo.latestVersion}`, 'true');
    }
    setIsUpdateModalOpen(false);
  }, [updateInfo, isWhatsNewModal, currentVersion]);

  return {
    updateInfo,
    currentVersion,
    isUpdateModalOpen,
    setIsUpdateModalOpen,
    isWhatsNewModal,
    setIsWhatsNewModal,
    openWhatsNewModal,
    isChecking,
    checkMessage,
    checkForUpdates,
    dismissUpdate
  };
}
