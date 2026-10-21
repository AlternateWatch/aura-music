import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { API_BASE } from '../utils/api';

export const CURRENT_APP_VERSION = "1.0.4";

export interface AppUpdateInfo {
  platform: string;
  latestVersion: string;
  versionCode?: number;
  releaseNotes: string;
  downloadUrl: string;
  mandatory?: boolean;
  publishedAt?: string;
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

export function useAppUpdate() {
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>(CURRENT_APP_VERSION);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
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

      const res = await fetch(`${API_BASE}/api/app/version`, {
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

  // Comprobar automáticamente al arrancar ÚNICAMENTE en Android nativo
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      return;
    }

    const timer = setTimeout(() => {
      checkForUpdates(false);
    }, 2500);

    return () => clearTimeout(timer);
  }, [checkForUpdates]);

  const dismissUpdate = useCallback(() => {
    if (updateInfo) {
      sessionStorage.setItem(`aura_dismissed_update_${updateInfo.latestVersion}`, 'true');
    }
    setIsUpdateModalOpen(false);
  }, [updateInfo]);

  return {
    updateInfo,
    currentVersion,
    isUpdateModalOpen,
    setIsUpdateModalOpen,
    isChecking,
    checkMessage,
    checkForUpdates,
    dismissUpdate
  };
}
