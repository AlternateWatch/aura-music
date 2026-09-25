import { useEffect, useRef } from "react";

/**
 * Lado JS del thumbbar de Windows (src-tauri/src/thumbbar.rs).
 *
 * - Escucha el evento "thumbbar-control" que emite Rust cuando el usuario
 *   pulsa uno de los 3 botones del preview de la barra de tareas, y lo
 *   traduce a las mismas acciones que ya usan los auriculares (useMediaSession)
 *   y el plugin nativo de Android (AuraMedia).
 * - Cada vez que cambia isPlaying, avisa a Rust para que actualice el icono
 *   del botón central (play <-> pausa).
 *
 * Solo hace algo cuando la app corre dentro de Tauri en Windows; en
 * cualquier otro caso (web, macOS/Linux, Android/iOS) no hace nada.
 */

interface UseWindowsThumbbarParams {
  isDesktop: boolean;
  isPlaying: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onTogglePlay: () => void;
}

export function useWindowsThumbbar({
  isDesktop,
  isPlaying,
  onNext,
  onPrevious,
  onTogglePlay,
}: UseWindowsThumbbarParams) {
  // onNext/onPrevious/onTogglePlay cambian de identidad entre renders
  // (dependen de la cola activa). Nos suscribimos al evento de Rust una
  // sola vez y usamos refs para llamar siempre a la versión más reciente,
  // en lugar de re-registrar el listener en cada render.
  const onNextRef = useRef(onNext);
  const onPreviousRef = useRef(onPrevious);
  const onTogglePlayRef = useRef(onTogglePlay);
  useEffect(() => {
    onNextRef.current = onNext;
    onPreviousRef.current = onPrevious;
    onTogglePlayRef.current = onTogglePlay;
  }, [onNext, onPrevious, onTogglePlay]);

  useEffect(() => {
    if (!isDesktop) return;

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const stop = await listen<string>("thumbbar-control", (event) => {
          switch (event.payload) {
            case "next":
              onNextRef.current();
              break;
            case "previous":
              onPreviousRef.current();
              break;
            case "toggle-play":
              onTogglePlayRef.current();
              break;
          }
        });
        if (cancelled) {
          stop();
        } else {
          unlisten = stop;
        }
      } catch {
        // No estamos en Tauri (o es una versión sin este comando/evento
        // todavía, p. ej. macOS/Linux): no pasa nada, simplemente no hay
        // thumbbar que gobernar.
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isDesktop]);

  useEffect(() => {
    if (!isDesktop) return;

    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("thumbbar_set_playing", { isPlaying });
      } catch {
        // Comando no disponible (no es Windows, o el módulo de thumbbar no
        // llegó a inicializarse): lo ignoramos, no es un error del usuario.
      }
    })();
  }, [isDesktop, isPlaying]);
}
