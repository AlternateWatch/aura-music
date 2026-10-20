import { API_BASE } from '../utils/api';
import type { Song } from '../constants';

export interface DjMixResult {
  title: string;
  description: string;
  vibeTags: string[];
  tracks: Song[];
}

const LOCAL_STORAGE_KEY = 'aura_gemini_api_key';

export function getStoredGeminiKey(): string {
  try {
    return localStorage.getItem(LOCAL_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveStoredGeminiKey(key: string): void {
  try {
    if (key.trim()) {
      localStorage.setItem(LOCAL_STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  } catch {}
}

/**
 * Genera una mezcla musical inteligente a partir de una descripción en lenguaje natural.
 * Intenta primero el endpoint del backend `/api/ai/dj`.
 * Si el backend no tiene clave o falla, usa fallback directo en cliente contra la API de Gemini.
 */
export async function generateDjMix(
  prompt: string,
  localSongs: Song[],
  userApiKey?: string,
  authToken?: string | null
): Promise<DjMixResult> {
  const activeKey = (userApiKey && userApiKey.trim()) || getStoredGeminiKey();

  // 1. Intento principal: Backend de Aura
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const res = await fetch(`${API_BASE}/api/ai/dj`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        apiKey: activeKey || undefined,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.tracks) && data.tracks.length > 0) {
        return data as DjMixResult;
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      // Si el servidor indica que falta la API key o no es válida, continuar al fallback cliente si el usuario tiene clave
      if (errData.error === 'MISSING_API_KEY' && !activeKey) {
        throw new Error('MISSING_API_KEY');
      }
    }
  } catch (backendErr: any) {
    if (backendErr.message === 'MISSING_API_KEY') {
      throw new Error('Configura tu API Key gratuita de Gemini para usar Aura DJ.');
    }
    // Si el backend no está disponible o devolvió error, intentamos directamente desde el cliente si hay clave
  }

  // 2. Fallback en cliente directo contra Gemini API (usando la API Key del usuario y las canciones locales)
  if (!activeKey) {
    throw new Error('Configura tu API Key gratuita de Gemini para usar Aura DJ (en Google AI Studio puedes generarla gratis en 1 clic).');
  }

  return generateDjMixDirect(prompt, localSongs, activeKey);
}

/**
 * Obtiene dinámicamente los modelos de Gemini disponibles para esta API Key,
 * priorizando las versiones Flash más rápidas y económicas.
 */
async function getAvailableModels(apiKey: string): Promise<string[]> {
  const fallbackList = [
    'gemini-3.5-flash-lite',
    'gemini-3-flash-preview',
    'gemini-3.5-flash',
    'gemini-flash-latest',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ];

  try {
    const listRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`
    );
    if (listRes.ok) {
      const data = await listRes.json();
      if (Array.isArray(data.models)) {
        const supported = data.models
          .filter((m: any) => 
            Array.isArray(m.supportedGenerationMethods) && 
            m.supportedGenerationMethods.includes('generateContent') &&
            !m.name.includes('-tts') &&
            !m.name.includes('-image') &&
            !m.name.includes('-transcribe') &&
            !m.name.includes('embedding')
          )
          .map((m: any) => m.name.replace(/^models\//, ''));

        const prioritized = [
          'gemini-3.5-flash-lite',
          'gemini-3-flash-preview',
          'gemini-3.5-flash',
          'gemini-flash-latest',
          'gemini-2.0-flash',
          'gemini-1.5-flash'
        ];

        const sorted = [
          ...prioritized.filter(p => supported.includes(p)),
          ...supported.filter(s => !prioritized.includes(s) && s.includes('flash')),
          ...supported.filter(s => !prioritized.includes(s) && !s.includes('flash'))
        ];

        if (sorted.length > 0) return Array.from(new Set(sorted));
      }
    }
  } catch {}

  // Fallbacks conocidos en caso de no poder listar modelos
  return fallbackList;
}

/**
 * Fallback directo en cliente contra la API REST de Google Gemini
 */
async function generateDjMixDirect(
  prompt: string,
  songs: Song[],
  apiKey: string
): Promise<DjMixResult> {
  if (!songs || songs.length === 0) {
    throw new Error('No hay canciones cargadas en la biblioteca para que el DJ pueda elegir.');
  }

  // Compactar catálogo para optimizar tokens
  const catalogList = songs
    .slice(0, 500)
    .map(s => `${s.id}|${s.title}|${s.artist}|${s.album || ''}`)
    .join('\n');

  const systemPrompt = `Eres "Aura DJ", un DJ y selector musical de clase mundial.
El usuario quiere una playlist para la siguiente situación: "${prompt.trim()}"

A continuación tienes las canciones disponibles en su biblioteca (Formato: ID|Título|Artista|Álbum):
${catalogList}

INSTRUCCIONES CRÍTICAS:
1. Elige entre 8 y 25 canciones que mejor encajen con la vibra, estilo, género o energía solicitada.
2. Si la petición es muy concreta y hay pocas canciones exactas, amplía con temas compatibles de artistas similares o misma energía.
3. Ordena las canciones con progresión musical atractiva (un inicio que enganche, desarrollo, subida de energía/clímax, y un buen cierre).
4. Devuelve ÚNICAMENTE un objeto JSON válido con esta estructura:
{
  "title": "Nombre creativo y atractivo para la mezcla",
  "description": "Una o dos frases explicando por qué estas canciones crean la atmósfera perfecta",
  "vibeTags": ["Rock", "Noche", "Energía"],
  "songIds": ["id1", "id2", "id3"]
}
IMPORTANTE: Usa ÚNICAMENTE IDs que existan en el catálogo. No inventes IDs.`;

  const models = await getAvailableModels(apiKey);
  let lastError: any = null;

  for (const model of models.slice(0, 4)) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.7,
          },
        }),
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        const msg = errorBody?.error?.message || `Error HTTP ${res.status}`;
        if (msg.includes('API key') || res.status === 400 && msg.includes('API_KEY')) {
          throw new Error('Tu API Key de Gemini no es válida. Compruébala en Google AI Studio.');
        }
        lastError = new Error(msg);
        continue; // Probar siguiente modelo
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) continue;

      const parsed = JSON.parse(rawText);
      const songMap = new Map<string, Song>();
      songs.forEach(s => songMap.set(String(s.id), s));

      const tracks: Song[] = [];
      const seen = new Set<string>();

      if (Array.isArray(parsed.songIds)) {
        parsed.songIds.forEach((sid: any) => {
          const key = String(sid);
          if (songMap.has(key) && !seen.has(key)) {
            tracks.push(songMap.get(key)!);
            seen.add(key);
          }
        });
      }

      if (tracks.length === 0) {
        throw new Error('No se encontraron canciones en tu biblioteca que coincidan con esa vibra.');
      }

      return {
        title: parsed.title || 'Aura DJ Mix',
        description: parsed.description || 'Selección personalizada creada por Aura DJ.',
        vibeTags: Array.isArray(parsed.vibeTags) ? parsed.vibeTags : ['Aura DJ', 'Mix'],
        tracks,
      };
    } catch (err: any) {
      lastError = err;
      if (err.message?.includes('API Key')) throw err;
    }
  }

  throw lastError || new Error('No se pudo generar la mezcla con Aura DJ.');
}
