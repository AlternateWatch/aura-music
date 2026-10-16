import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'aura_music_db',
    waitForConnections: true,
    connectionLimit: 5,
});

const cleanBrokenTracks = async () => {
    console.log("🔍 Iniciando escaneo de canciones y archivos huérfanos...");
    try {
        const [tracks] = await pool.execute('SELECT id, title, file_path, cover_path, animated_cover_path FROM tracks');
        
        let deletedCount = 0;

        for (const track of tracks) {
            // Limpiar la ruta relativa para obtener el nombre o ruta local correcta
            const getAbsPath = (p) => {
                if (!p) return null;
                const clean = p.startsWith('/') ? p.substring(1) : p;
                return path.join(__dirname, 'public', clean);
            };

            const audioAbs = getAbsPath(track.file_path);
            const coverAbs = getAbsPath(track.cover_path);
            const animAbs = getAbsPath(track.animated_cover_path);

            // Comprobamos si falta el archivo de audio principal (que es el core de la canción)
            const audioExists = audioAbs && fs.existsSync(audioAbs);

            if (!audioExists) {
                console.log(`❌ Archivo de audio físico no encontrado para ID ${track.id} (${track.title}). Borrando registro y restos...`);

                // Borrar archivos físicos restantes si existen
                if (audioAbs && fs.existsSync(audioAbs)) fs.unlinkSync(audioAbs);
                if (coverAbs && fs.existsSync(coverAbs)) fs.unlinkSync(coverAbs);
                if (animAbs && fs.existsSync(animAbs)) fs.unlinkSync(animAbs);

                // Borrar de la base de datos (incluyendo likes y relaciones en playlists para evitar errores de FK)
                await pool.execute('DELETE FROM user_likes WHERE track_id = ?', [track.id]);
                await pool.execute('DELETE FROM playlist_tracks WHERE track_id = ?', [track.id]);
                await pool.execute('DELETE FROM tracks WHERE id = ?', [track.id]);

                deletedCount++;
            }
        }

        console.log(`✨ Limpieza terminada. Se han eliminado ${deletedCount} registros rotos y sus archivos asociados.`);
    } catch (error) {
        console.error("❌ Error durante la limpieza:", error);
    } finally {
        await pool.end();
    }
};

cleanBrokenTracks();
