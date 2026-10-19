import path from 'path';
import fs from 'fs';
import mysql from 'mysql2/promise';
import { isB2Configured, downloadB2FileToDisk } from './b2Storage.js';

let isCachingInProgress = false;

export interface CacheStats {
    totalTopTracks: number;
    downloadedAudio: number;
    downloadedCovers: number;
    alreadyCached: number;
    purgedOldTracks: number;
    durationMs: number;
}

/**
 * Consulta las 100 canciones más escuchadas y queridas de la biblioteca
 * y las guarda en el disco local para una reproducción instantánea con 0ms de latencia.
 */
export const cacheTop100Tracks = async (
    pool: mysql.Pool,
    uploadDir: string
): Promise<CacheStats | null> => {
    if (isCachingInProgress) {
        console.log('⏳ [CacheService] Ya hay un proceso de pre-caché en ejecución. Omitiendo.');
        return null;
    }

    if (!isB2Configured()) {
        console.log('ℹ️ [CacheService] Backblaze B2 no está configurado, omitiendo pre-caché.');
        return null;
    }

    isCachingInProgress = true;
    const startTime = Date.now();
    console.log('\n🔥 [CacheService] Iniciando pre-caché diario de las 100 canciones más escuchadas...');

    const stats: CacheStats = {
        totalTopTracks: 0,
        downloadedAudio: 0,
        downloadedCovers: 0,
        alreadyCached: 0,
        purgedOldTracks: 0,
        durationMs: 0
    };

    try {
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // Consultar el Top 100 combinando escuchas (listen_pings) y favoritos (user_likes)
        const [rows]: any = await pool.execute(`
            SELECT t.id, t.title, t.artist, t.file_path, t.cover_path,
                   (COALESCE((SELECT COUNT(*) FROM listen_pings lp WHERE lp.track_id = t.id), 0) * 2 +
                    COALESCE((SELECT COUNT(*) FROM user_likes ul WHERE ul.track_id = t.id), 0)) as score
            FROM tracks t
            WHERE t.status = 'approved'
            ORDER BY score DESC, t.id DESC
            LIMIT 100
        `);

        stats.totalTopTracks = rows.length;
        console.log(`📊 [CacheService] Se encontraron ${rows.length} canciones prioritarias para el Top 100.`);

        const topFilenames = new Set<string>();

        // Descargar canciones y portadas prioritarias
        for (let i = 0; i < rows.length; i++) {
            const track = rows[i];
            const audioFilename = track.file_path ? path.basename(track.file_path.split('?')[0]) : null;
            const coverFilename = track.cover_path ? path.basename(track.cover_path.split('?')[0]) : null;

            if (audioFilename && audioFilename !== '.' && audioFilename !== '..') {
                topFilenames.add(audioFilename);
                const localAudioPath = path.join(uploadDir, audioFilename);
                if (fs.existsSync(localAudioPath)) {
                    stats.alreadyCached++;
                } else {
                    const ok = await downloadB2FileToDisk(audioFilename, localAudioPath);
                    if (ok) {
                        stats.downloadedAudio++;
                        console.log(`[CacheService ${i + 1}/${rows.length}] 🎵 Descargada a caché: "${track.title}" - ${track.artist}`);
                    }
                }
            }

            if (coverFilename && coverFilename !== '.' && coverFilename !== '..' && !/^default[-_\s]?cover\./i.test(coverFilename)) {
                topFilenames.add(coverFilename);
                const localCoverPath = path.join(uploadDir, coverFilename);
                if (!fs.existsSync(localCoverPath)) {
                    const ok = await downloadB2FileToDisk(coverFilename, localCoverPath);
                    if (ok) stats.downloadedCovers++;
                }
            }
        }

        // Limpiar del disco canciones viejas que hayan salido del Top 100
        // (así el disco del VPS nunca supera ~800MB - 1GB)
        try {
            const diskFiles = fs.readdirSync(uploadDir);
            for (const file of diskFiles) {
                // Solo limpiar archivos de audio que no pertenezcan al Top 100 actual
                const isAudio = /\.(mp3|flac|m4a|wav|ogg|aac)$/i.test(file);
                if (isAudio && !topFilenames.has(file)) {
                    const filePath = path.join(uploadDir, file);
                    try {
                        fs.unlinkSync(filePath);
                        stats.purgedOldTracks++;
                    } catch {}
                }
            }
        } catch (cleanupErr: any) {
            console.warn('[CacheService] Aviso al limpiar canciones antiguas:', cleanupErr.message);
        }

        stats.durationMs = Date.now() - startTime;
        console.log(`✨ [CacheService] Pre-caché diario completado en ${(stats.durationMs / 1000).toFixed(1)}s:`);
        console.log(`   - Listas en disco local: ${stats.alreadyCached + stats.downloadedAudio} canciones`);
        console.log(`   - Nuevas descargadas hoy: ${stats.downloadedAudio} audios, ${stats.downloadedCovers} portadas`);
        console.log(`   - Purgadas de caché (salieron del top): ${stats.purgedOldTracks} canciones\n`);

        return stats;
    } catch (err: any) {
        console.error('❌ [CacheService] Error durante el pre-caché:', err.message);
        return null;
    } finally {
        isCachingInProgress = false;
    }
};

/**
 * Planificador diario: se ejecuta 15 segundos después de iniciar el servidor
 * y luego de forma recurrente cada 24 horas (o a las 4:00 AM).
 */
export const startDailyCacheScheduler = (pool: mysql.Pool, uploadDir: string) => {
    // 1. Ejecución inicial con retraso para no entorpecer el arranque del servidor
    setTimeout(() => {
        cacheTop100Tracks(pool, uploadDir).catch(() => {});
    }, 15000);

    // 2. Programar ejecución diaria cada 24 horas
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    setInterval(() => {
        cacheTop100Tracks(pool, uploadDir).catch(() => {});
    }, ONE_DAY_MS);

    console.log('⏰ [CacheService] Planificador diario de caché activado (Top 100 canciones).');
};
