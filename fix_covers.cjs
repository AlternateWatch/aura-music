const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function fixCovers() {
    console.log("--- DEBUG START ---");
    console.log("📅 Fecha:", new Date().toLocaleString());

    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'admin',
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME || 'aura_music_db',
            connectTimeout: 10000
        });
        console.log("✅ Conexión al pool establecida");
    } catch (err) {
        console.error("❌ Error creando el pool:", err);
        return;
    }

    const uploadDir = path.join(__dirname, 'public', 'uploads');
    console.log("📂 Buscando archivos en:", uploadDir);

    if (!fs.existsSync(uploadDir)) {
        console.error("❌ ERROR: La carpeta de uploads no existe en esta ruta.");
        return;
    }

    try {
        console.log("📡 Consultando base de datos...");
        const [tracks] = await pool.execute('SELECT id, cover_path FROM tracks WHERE cover_path IS NOT NULL');

        if (!tracks || tracks.length === 0) {
            console.log("⚠️ No se encontraron canciones con portada en la base de datos.");
            return;
        }

        console.log(`🔍 Analizando ${tracks.length} canciones...`);
        let fixedCount = 0;

        for (const track of tracks) {
            const currentPath = track.cover_path;
            const filename = path.basename(currentPath);
            const fullPath = path.join(uploadDir, filename);

            if (!fs.existsSync(fullPath)) {
                const alternativeFilename = `Image${filename}`;
                const alternativePath = path.join(uploadDir, alternativeFilename);

                if (fs.existsSync(alternativePath)) {
                    const newPath = currentPath.replace(filename, alternativeFilename);
                    await pool.execute('UPDATE tracks SET cover_path = ? WHERE id = ?', [newPath, track.id]);
                    console.log(`✅ Corregido: ${filename} -> ${alternativeFilename}`);
                    fixedCount++;
                }
            }
        }

        console.log(`\n✨ TERMINADO: Se han corregido ${fixedCount} portadas.`);
    } catch (err) {
        console.error("❌ ERROR CRÍTICO:", err);
    } finally {
        if (pool) await pool.end();
        console.log("--- DEBUG END ---");
    }
}

fixCovers().catch(console.error);