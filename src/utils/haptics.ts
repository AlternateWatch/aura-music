import { Capacitor } from "@capacitor/core";

// Vibración táctil corta al tocar los controles principales, solo en la
// app móvil nativa (Android/iOS vía Capacitor). En web y en la app de
// escritorio (Tauri) esto no hace nada — Capacitor.isNativePlatform()
// devuelve false ahí, así que ni siquiera se intenta cargar el plugin.
// Todo envuelto en try/catch: si el plugin no está instalado, el
// dispositivo no lo soporta, o falla por cualquier motivo, sencillamente
// no vibra — nunca debe romper una acción del usuario ni bloquear nada.

type ImpactLevel = "light" | "medium" | "heavy";

export async function hapticImpact(style: ImpactLevel = "light"): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    const styleMap: Record<ImpactLevel, any> = {
      light: ImpactStyle.Light,
      medium: ImpactStyle.Medium,
      heavy: ImpactStyle.Heavy,
    };
    await Haptics.impact({ style: styleMap[style] });
  } catch (e) {
    // Sin plugin, sin soporte del dispositivo, o cualquier otro fallo:
    // no hacemos nada. Nunca debe interrumpir la acción real del usuario.
  }
}
