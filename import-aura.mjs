import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import { parseFile } from 'music-metadata';

const uploadDir = path.join(process.cwd(), 'public', 'uploads');

const files = fs.readdirSync(uploadDir)
    .filter(f => /\.(mp3|flac)$/i.test(f))
    .sort();

const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'aura_music_db'
});

await db.beginTransaction();

let imported = 0;
let skipped = 0;
let covers = 0;

try {
    for (const file of files) {
        const fullPath = path.join(uploadDir, file);

        try {
            const meta = await parseFile(fullPath, { skipCovers: false });

            const title = (meta.common.title || '').trim() || path.basename(file, path.extname(file));
            const artist = (meta.common.artist || '').trim() || 'Artista desconocido';
            const album = (meta.common.album || '').trim() || null;
            const trackNumber = meta.common.track?.no || null;

            let coverPath = null;
            const pic = meta.common.picture?.[0];

            if (pic?.data) {
                const ext =
                    pic.format === 'image/png' ? '.png' :
                    pic.format === 'image/webp' ? '.webp' :
                    '.jpg';

                const base = path.basename(file, path.extname(file));
                const coverFile = `aura-cover-${base}${ext}`;
                const coverFullPath = path.join(uploadDir, coverFile);

                if (!fs.existsSync(coverFullPath)) {
                    fs.writeFileSync(coverFullPath, pic.data);
                }

                coverPath = `/uploads/${coverFile}`;
                covers++;
            }

            const format = path.extname(file).toLowerCase() === '.flac' ? 'flac' : 'mp3';

            await db.execute(
                `INSERT INTO tracks
                (title, artist, album, file_path, cover_path, added_by, status, format, tabs_url, track_number)
                VALUES (?, ?, ?, ?, ?, 1, 'approved', ?, NULL, ?)`,
                [
                    title,
                    artist,
                    album,
                    `/uploads/${file}`,
                    coverPath,
                    format,
                    trackNumber
                ]
            );

            imported++;
            console.log(`✓ ${imported}: ${artist} - ${title}`);

        } catch (err) {
            skipped++;
            console.log(`✗ OMITIDA: ${file} -> ${err.message}`);
        }
    }

    await db.commit();

    console.log('\n========================================');
    console.log(`IMPORTADAS: ${imported}`);
    console.log(`OMITIDAS:   ${skipped}`);
    console.log(`PORTADAS:   ${covers}`);
    console.log('========================================\n');

} catch (err) {
    await db.rollback();
    console.error('ERROR FATAL. Se ha hecho ROLLBACK:', err);
    process.exit(1);
}

await db.end();
