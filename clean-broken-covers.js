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

const cleanBrokenCovers = async () => {
    console.log("🔍 Escaneando portadas huérfanas o rotas...");
    try {
        const [tracks] = await pool.execute('SELECT id, title, cover_path, animated_cover_path FROM tracks');
        
        let fixedCount = 0;

        for (const track of tracks) {
            const getAbsPath = (p) => {
                if (!p) return null;
                const clean = p.startsWith('/') ? p.substring(1) : p;
                return path.join(__dirname, 'public', clean);
            };

            const coverAbs = getAbsPath(track.cover_path);
            const animAbs = getAbsPath(track.animated_cover_path);

            let updateNeeded = false;
            let newCoverPath = track.cover_path;
            let newAnimPath = track.animated_cover_path;

            // Si hay ruta de portada pero el archivo no existe en disco
            if (track.cover_path && coverAbs && !fs.existsSync(coverAbs)) {
                console.log(`🖼️ Portada rota detectada en ID ${track.id} (${track.title}): ${track.cover_path}`);
                newCoverPath = null;
                updateNeeded = true;
            }

            // Si hay ruta de portada animada pero el archivo no existe en disco
            if (track.animated_cover_path && animAbs && !fs.existsSync(animAbs)) {
                console.log(`🎬 Portada animada rota detectada en ID ${track.id} (${track.title})`);
                newAnimPath = null;
                updateNeeded = true;
            }

            if (updateNeeded) {
                await pool.execute(
                    'UPDATE tracks SET cover_path = ?, animated_cover_path = ? WHERE id = ?',
                    [newCoverPath, newAnimPath, track.id]
                );
                fixedCount++;
            }
        }

        console.log(`✨ Limpieza de portadas finalizada. Se han saneado ${fixedCount} registros.`);
    } catch (error) {
        console.error("❌ Error limpiando portadas:", error);
    } finally {
        await pool.end();
    }
};

cleanBrokenCovers();
