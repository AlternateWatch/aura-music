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

/**
 * Consulta la clave de Gemini del usuario guardada de forma cifrada en la base de datos
 * y sincroniza la caché local.
 */
export async function fetchAndSyncGeminiKey(authToken?: string | null): Promise<string> {
  const activeToken = authToken || (typeof localStorage !== 'undefined' ? localStorage.getItem('aura_token') : null);
  if (!activeToken) return getStoredGeminiKey();

  try {
    const res = await fetch(`${API_BASE}/api/user/gemini-key`, {
      headers: {
        'Authorization': `Bearer ${activeToken}`
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.apiKey === 'string') {
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, data.apiKey);
        } catch {}
        return data.apiKey;
      }
    }
  } catch (err) {
    console.warn("No se pudo obtener la API Key de Gemini desde la base de datos:", err);
  }

  return getStoredGeminiKey();
}

/**
 * Guarda la clave de Gemini en localStorage y de forma cifrada en la base de datos
 * asociada al usuario actual.
 */
export async function saveStoredGeminiKey(key: string, authToken?: string | null): Promise<void> {
  const cleanKey = key.trim();
  try {
    if (cleanKey) {
      localStorage.setItem(LOCAL_STORAGE_KEY, cleanKey);
    } else {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  } catch {}

  const activeToken = authToken || (typeof localStorage !== 'undefined' ? localStorage.getItem('aura_token') : null);
  if (activeToken) {
    try {
      await fetch(`${API_BASE}/api/user/gemini-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeToken}`
        },
        body: JSON.stringify({ apiKey: cleanKey || null })
      });
    } catch (err) {
      console.warn("No se pudo guardar la API Key cifrada en la base de datos:", err);
    }
  }
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
  let activeKey = (userApiKey && userApiKey.trim()) || getStoredGeminiKey();

  // Si no hay clave local pero hay sesión, intentar sincronizarla
  if (!activeKey && authToken) {
    activeKey = await fetchAndSyncGeminiKey(authToken);
  }

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

  return generateDjMixClientSide(prompt, localSongs, activeKey);
}

/**
 * Obtiene dinámicamente los modelos de Gemini disponibles para esta API Key,
 * ordenados por preferencia (modelos Flash rápidos y ligeros).
 */
async function getAvailableModels(apiKey: string): Promise<string[]> {
  const preferredOrder = [
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ];

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`,
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.models)) {
        const availableNames: string[] = data.models
          .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m: any) => m.name.replace(/^models\//, ''));

        const sorted = availableNames.sort((a, b) => {
          const indexA = preferredOrder.findIndex(p => a.includes(p));
          const indexB = preferredOrder.findIndex(p => b.includes(p));
          if (indexA !== -1 && indexB !== -1) return indexA - indexB;
          if (indexA !== -1) return -1;
          if (indexB !== -1) return 1;
          return a.localeCompare(b);
        });

        if (sorted.length > 0) return sorted;
      }
    }
  } catch {
    // Fallback a lista predefinida si el endpoint de list models no responde
  }

  return preferredOrder;
}

/**
 * Fallback directo en cliente contra la API REST de Google Gemini
 */
async function generateDjMixClientSide(
  prompt: string,
  localSongs: Song[],
  apiKey: string
): Promise<DjMixResult> {
  if (!localSongs || localSongs.length === 0) {
    throw new Error('No hay canciones en tu biblioteca local para mezclar.');
  }

  const catalog = localSongs.slice(0, 300).map(s => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    album: s.album || ''
  }));

  const systemInstruction = `Eres "Aura DJ", un selector musical inteligente de una app de música.
Tu trabajo es responder EXCLUSIVAMENTE con un JSON válido estructurado así:
{
  "title": "Nombre creativo de la sesión / mix (máx 5 palabras)",
  "description": "Una frase corta evocadora y profesional que describa el flujo de la sesión",
  "vibeTags": ["tag1", "tag2", "tag3"],
  "trackIds": ["id1", "id2", "id3", ...]
}
REGLAS:
- Selecciona entre 6 y 18 canciones del catálogo proporcionado que mejor encajen con la petición del usuario.
- El orden debe tener una progresión de ritmo/atmósfera fluida (como una sesión de DJ real).
- Solo utiliza IDs que existan en el catálogo. No inventes IDs.
- Devuelve ÚNICAMENTE el bloque JSON, sin introducciones ni marcas de formato fuera del JSON.`;

  const userContent = `PETICIÓN DEL USUARIO: "${prompt.trim()}"

CATÁLOGO DISPONIBLE:
${JSON.stringify(catalog)}`;

  const models = await getAvailableModels(apiKey);
  let lastError: any = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemInstruction}\n\n${userContent}` }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json'
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        const msg = (errText || '').toLowerCase();
        if (msg.includes('api key') || (res.status === 400 && msg.includes('api_key'))) {
          throw new Error('Tu API Key de Gemini no es válida. Compruébala en Google AI Studio.');
        }
        lastError = new Error(`HTTP ${res.status}: ${errText.slice(0, 150)}`);
        continue;
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error('Respuesta vacía del modelo Gemini.');

      const cleanJson = rawText.replace(/```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleanJson);

      const songMap = new Map(localSongs.map(s => [String(s.id), s]));
      const selectedTracks: Song[] = [];

      if (Array.isArray(parsed.trackIds)) {
        for (const tid of parsed.trackIds) {
          const found = songMap.get(String(tid));
          if (found && !selectedTracks.some(st => String(st.id) === String(found.id))) {
            selectedTracks.push(found);
          }
        }
      }

      if (selectedTracks.length === 0) {
        throw new Error('El modelo no seleccionó canciones existentes en la biblioteca.');
      }

      return {
        title: parsed.title || 'Aura Mix',
        description: parsed.description || 'Sesión generada por Aura DJ',
        vibeTags: Array.isArray(parsed.vibeTags) ? parsed.vibeTags : ['Aura DJ'],
        tracks: selectedTracks
      };
    } catch (err: any) {
      lastError = err;
      if (err.message?.includes('API Key')) throw err;
      continue;
    }
  }

  throw lastError || new Error('No se pudo generar la mezcla con los modelos de Gemini disponibles.');
}
