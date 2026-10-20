process.env.UV_THREADPOOL_SIZE = '16';
import express, { Request, Response, NextFunction } from 'express';

import { createServer } from 'http';

import { Server } from 'socket.io';

import mysql from 'mysql2/promise';

import bcrypt from 'bcryptjs';

import jwt from 'jsonwebtoken';

import cors from 'cors';

import dotenv from 'dotenv';

import path from 'path';

import fs from 'fs';

import multer from 'multer';

import { fileURLToPath } from 'url';

import axios from "axios";

import config from './config.json' assert { type: 'json' };

import { isB2Configured, getMissingB2EnvVars, uploadToB2, getB2ObjectStream, deleteFromB2, checkB2FileExists, downloadB2FileToDisk, listB2Files } from './b2Storage.js';
import { startDailyCacheScheduler, cacheTop100Tracks } from './cacheService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Cuando PM2 ejecuta ./dist/server.js, __dirname es /var/www/aura-music/dist.
// Calculamos ROOT_DIR siempre en la raíz del proyecto para que las subidas NUNCA vayan a dist/public/uploads.
const ROOT_DIR = path.basename(__dirname) === 'dist' ? path.resolve(__dirname, '..') : __dirname;
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const syncFileToB2 = async (filename: string, localFilePath: string, mimetype?: string, size?: number, deleteLocalAfter = true) => {
    if (!isB2Configured()) {
        console.warn(`⚠️ [B2] Omitiendo sincronización de "${filename}": Backblaze B2 no está configurado en .env`);
        return;
    }
    if (!fs.existsSync(localFilePath)) {
        console.warn(`⚠️ [B2] Archivo local "${localFilePath}" no encontrado para sincronizar con B2.`);
        return;
    }
    try {
        console.log(`☁️ [B2] Subiendo "${filename}" a Backblaze B2...`);
        await uploadToB2(filename, fs.createReadStream(localFilePath), mimetype, size);
        console.log(`✅ [B2] "${filename}" sincronizado con Backblaze B2 correctamente.`);
        if (deleteLocalAfter) {
            try { fs.unlinkSync(localFilePath); } catch {}
        }
    } catch (err: any) {
        console.error(`❌ [B2] Error sincronizando ${filename} con B2:`, err.message);
        throw err;
    }
};
const DIST_DIR = path.basename(__dirname) === 'dist' ? __dirname : path.join(__dirname, 'dist');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: true,
    credentials: true,
    methods: ["GET", "POST"]
  }
});

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'aura_ultimate_stable_secret_key_2026_production';

// STORAGE
const resolveUploadDir = (): string => {
    if (process.env.UPLOAD_DIR) return process.env.UPLOAD_DIR;
    if (process.platform !== 'win32' && fs.existsSync('/var/www/aura-uploads')) {
        return '/var/www/aura-uploads';
    }
    const rootUploads = path.join(ROOT_DIR, 'public', 'uploads');
    try {
        if (fs.existsSync(rootUploads)) {
            const st = fs.statSync(rootUploads);
            if (st.isDirectory()) return rootUploads;
            // En Windows sin symlinks git, public/uploads puede ser el archivo de texto del symlink (21 bytes)
            if (st.isFile() && st.size < 256) {
                const winFallback = path.join(ROOT_DIR, 'uploads_local');
                if (!fs.existsSync(winFallback)) fs.mkdirSync(winFallback, { recursive: true });
                return winFallback;
            }
        }
    } catch {}
    if (!fs.existsSync(rootUploads)) {
        try { fs.mkdirSync(rootUploads, { recursive: true }); } catch {}
    }
    return rootUploads;
};

const uploadDir = resolveUploadDir();
if (!fs.existsSync(uploadDir)) {
    try { fs.mkdirSync(uploadDir, { recursive: true }); } catch {}
}

// Auto-rescate: si ejecuciones previas de dist/server.js guardaron archivos en dist/public/uploads,
// moverlos al uploadDir persistente para que vite build no los borre jamás.
for (const trappedDir of [path.join(DIST_DIR, 'public', 'uploads'), path.join(DIST_DIR, 'uploads')]) {
    try {
        if (trappedDir !== uploadDir && fs.existsSync(trappedDir) && fs.statSync(trappedDir).isDirectory()) {
            for (const f of fs.readdirSync(trappedDir)) {
                const src = path.join(trappedDir, f);
                const dest = path.join(uploadDir, f);
                if (!fs.existsSync(dest) && fs.statSync(src).isFile()) {
                    fs.copyFileSync(src, dest);
                    console.log(`🛟 Archivo rescatado a uploadDir persistente: ${f}`);
                }
            }
        }
    } catch (e) {
        console.warn("Aviso al rescatar archivos antiguos de dist:", e);
    }
}

// Normaliza rutas guardadas en BD (convierte https://aura.basildo.me/uploads/x.jpg -> /uploads/x.jpg)
const normalizeMediaPath = (rawPath: string | null | undefined): string | null => {
    if (!rawPath || typeof rawPath !== 'string') return null;
    const trimmed = rawPath.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;
    if (trimmed.includes('/uploads/')) {
        const cleanName = path.basename(trimmed.split('?')[0]);
        return `/uploads/${cleanName}`;
    }
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
    }
    return `/uploads/${path.basename(trimmed)}`;
};

// Resuelve un path de BD (/uploads/x.jpg o URL completa) a su ruta física real en disco
const resolveDiskPath = (dbPath: string | null | undefined): string | null => {
    if (!dbPath || typeof dbPath !== 'string') return null;
    const trimmed = dbPath.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;
    const filename = path.basename(trimmed.split('?')[0]);
    if (!filename || filename === '.' || filename === '..') return null;
    const primary = path.join(uploadDir, filename);
    if (fs.existsSync(primary)) return primary;
    const fallbackRoot = path.join(ROOT_DIR, 'public', 'uploads', filename);
    if (fs.existsSync(fallbackRoot)) return fallbackRoot;
    const fallbackDist = path.join(DIST_DIR, 'uploads', filename);
    if (fs.existsSync(fallbackDist)) return fallbackDist;
    return primary;
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, uploadDir); },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } });

// DATABASE
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'aura_music_db',
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true
});

const authenticateToken = (req: any, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "No token." });
    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
        if (err) return res.status(403).json({ error: "Invalid session." });
        req.user = user;
        next();
    });
};

// Solo borra un archivo de disco si ninguna otra canción en la BD lo sigue referenciando
const unlinkTrackAssetIfUnused = async (dbPath: string | null | undefined, excludeTrackId?: string | number): Promise<boolean> => {
    if (!dbPath) return false;
    try {
        const filename = path.basename(dbPath.split('?')[0]);
        if (!filename || /^default[-_\s]?cover\./i.test(filename)) return false;
        const likePattern = `%/${filename}`;
        const [rows]: any = await pool.execute(
            'SELECT COUNT(*) as cnt FROM tracks WHERE id != ? AND (file_path = ? OR file_path LIKE ? OR cover_path = ? OR cover_path LIKE ? OR animated_cover_path = ? OR animated_cover_path LIKE ?)',
            [excludeTrackId ?? -1, `/uploads/${filename}`, likePattern, `/uploads/${filename}`, likePattern, `/uploads/${filename}`, likePattern]
        );
        if ((rows[0]?.cnt ?? 0) > 0) {
            return false; // Sigue en uso por otra canción (ej. portada compartida de álbum)
        }
        const diskPath = resolveDiskPath(dbPath);
        if (diskPath && fs.existsSync(diskPath)) {
            try { fs.unlinkSync(diskPath); } catch {}
        }
        if (isB2Configured()) {
            deleteFromB2(filename).catch(() => {});
        }
        return true;
    } catch (e) {
        console.error("Error checking/deleting asset:", e);
    }
    return false;
};

const deleteTrackFiles = async (trackId: string) => {
    try {
        const [rows]: any = await pool.execute('SELECT file_path, cover_path, animated_cover_path FROM tracks WHERE id = ?', [trackId]);
        if (rows[0]) {
            const track = rows[0];
            await unlinkTrackAssetIfUnused(track.file_path, trackId);
            await unlinkTrackAssetIfUnused(track.cover_path, trackId);
            await unlinkTrackAssetIfUnused(track.animated_cover_path, trackId);
        }
    } catch (e) { console.error("Cleanup failed", e); }
};

// --- AUTH ---

const isCapacitorApp = (req: Request) => {

    return req.headers.origin === 'https://localhost';

};



app.post('/api/auth/register', async (req: Request, res: Response) => {

    const { username, email, password, turnstileToken } = req.body;



    try {

        if (!isCapacitorApp(req)) {

            const verification = await axios.post(

                "https://challenges.cloudflare.com/turnstile/v0/siteverify",

                new URLSearchParams({

                    secret: process.env.TURNSTILE_SECRET!,

                    response: turnstileToken,

                    remoteip: req.ip as string

                }),

                {

                    headers: {

                        "Content-Type": "application/x-www-form-urlencoded"

                    }

                }

            );



            if (!verification.data.success) {

                return res.status(400).json({ error: "Captcha failed." });

            }

        }



        const hashedPassword = await bcrypt.hash(password, 10);



        await pool.execute(

            'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',

            [username, email, hashedPassword]

        );



        res.status(201).json({ message: "Success" });



    } catch (error) {

        res.status(400).json({ error: "User exists" });

    }

});



app.post('/api/auth/login', async (req: Request, res: Response) => {

    const { email, password, turnstileToken } = req.body;



    try {

        if (!isCapacitorApp(req)) {

            const verification = await axios.post(

                "https://challenges.cloudflare.com/turnstile/v0/siteverify",

                new URLSearchParams({

                    secret: process.env.TURNSTILE_SECRET!,

                    response: turnstileToken,

                    remoteip: req.ip as string

                }),

                {

                    headers: {

                        "Content-Type": "application/x-www-form-urlencoded"

                    }

                }

            );



            if (!verification.data.success) {

                return res.status(400).json({ error: "Captcha failed." });

            }

        }



        const [rows]: any = await pool.execute(

            'SELECT * FROM users WHERE email = ?',

            [email]

        );



        const user = rows[0];



        if (user && await bcrypt.compare(password, user.password_hash)) {

            const token = jwt.sign(

                {

                    userId: user.id,

                    username: user.username,

                    role: user.role

                },

                JWT_SECRET,

                { expiresIn: '7d' }

            );



            res.json({

                token,

                username: user.username,

                role: user.role,

                userId: user.id,

                profile_pic_path: user.profile_pic_path,

                custom_bg_path: user.custom_bg_path

            });

        } else {

            res.status(401).json({ error: "Invalid credentials" });

        }



    } catch (error) {

        res.status(500).json({ error: "Server error" });

    }

});



// --- TRACKS (Con Soporte para Likes) ---

app.get('/api/tracks', async (req, res) => { 

    const s = req.query.status || 'approved';

    const authHeader = req.headers['authorization'];

    const token = authHeader && authHeader.split(' ')[1];

    let userId = null;

    

    if (token) {

        try { const decoded: any = jwt.verify(token, JWT_SECRET); userId = decoded.userId; } catch(e) {}

    }



    try { 

        // Consulta que devuelve si la canción está en user_likes para el usuario actual

        const query = `

            SELECT t.*, 

            (SELECT COUNT(*) FROM user_likes WHERE track_id = t.id AND user_id = ?) as is_liked 

            FROM tracks t 

            WHERE t.status = ? 

            ORDER BY t.album ASC, t.track_number ASC

        `;

        const [t] = await pool.execute(query, [userId, s]); 

        res.json(t); 

    } catch (e) { res.status(500).send(); } 

});



app.post('/api/tracks', authenticateToken, upload.fields([{ name: 'audio' }, { name: 'cover' }]), async (req: any, res: Response) => {
    const { title, artist, album, tabs_url, track_number, video_url, cover_url } = req.body;
    if (!req.files?.['audio']) return res.status(400).json({ error: "No audio" });

    let downloadedCoverFile: string | null = null;

    // Si algo falla, borrar los archivos que multer o la descarga remota ya guardo en disco
    const cleanupUploaded = () => {
        for (const field of ['audio', 'cover']) {
            const f = req.files?.[field]?.[0];
            if (f?.path && fs.existsSync(f.path)) {
                try { fs.unlinkSync(f.path); } catch {}
            }
        }
        if (downloadedCoverFile && fs.existsSync(downloadedCoverFile)) {
            try { fs.unlinkSync(downloadedCoverFile); } catch {}
        }
    };

    try {
        const format = path.extname(req.files['audio'][0].originalname).includes('flac') ? 'flac' : 'mp3';
        const initialStatus = (req.user.role === 'admin' || req.user.role === 'moderator') ? 'approved' : 'pending';

        let coverPath: string | null = null;
        if (req.files?.['cover']?.[0]) {
            coverPath = `/uploads/${req.files['cover'][0].filename}`;
        } else if (cover_url && typeof cover_url === 'string' && cover_url.startsWith('http')) {
            try {
                const imgRes = await axios.get(cover_url, {
                    responseType: 'arraybuffer',
                    timeout: 10000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                });
                const filename = `cover_${Date.now()}_${Math.round(Math.random() * 1e9)}.jpg`;
                if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
                downloadedCoverFile = path.join(uploadDir, filename);
                fs.writeFileSync(downloadedCoverFile, Buffer.from(imgRes.data));
                coverPath = `/uploads/${filename}`;
            } catch (coverErr) {
                console.warn("No se pudo descargar la portada remota en el servidor:", coverErr);
            }
        }

        const [result]: any = await pool.execute(
            'INSERT INTO tracks (title, artist, album, file_path, cover_path, added_by, status, format, tabs_url, video_url, track_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [title, artist, album, `/uploads/${req.files['audio'][0].filename}`, coverPath, req.user.userId, initialStatus, format, tabs_url || null, video_url || null, track_number || null]
        );

        // Subir directamente a Backblaze B2 y limpiar el archivo temporal local
        if (isB2Configured()) {
            const aFile = req.files['audio'][0];
            await syncFileToB2(aFile.filename, aFile.path, aFile.mimetype, aFile.size);
            if (req.files?.['cover']?.[0]) {
                const cFile = req.files['cover'][0];
                await syncFileToB2(cFile.filename, cFile.path, cFile.mimetype, cFile.size);
            } else if (downloadedCoverFile && fs.existsSync(downloadedCoverFile)) {
                await syncFileToB2(path.basename(downloadedCoverFile), downloadedCoverFile, 'image/jpeg');
            }
        } else {
            console.warn(`⚠️ [Upload] Backblaze B2 no está configurado en .env. La pista "${title}" se guardó únicamente en el disco local (${uploadDir}).`);
        }

        res.status(201).json({ id: result.insertId });
    } catch (e) {
        console.error("Error uploading track:", e);
        cleanupUploaded();
        res.status(500).json({ error: "Error guardando la pista en la base de datos." });
    }
});

app.post('/api/stats/ping', authenticateToken, async (req: any, res: Response) => {
    try {
        const { trackId, title, artist, album, ms } = req.body || {};
        const cleanMs = Math.max(1000, Math.min(Number(ms) || 0, 60000));
        if (title && artist) {
            await pool.execute(
                'INSERT INTO listen_pings (user_id, track_id, title, artist, album, ms) VALUES (?, ?, ?, ?, ?, ?)',
                [req.user.userId, trackId || null, String(title).slice(0, 255), String(artist).slice(0, 255), album ? String(album).slice(0, 255) : null, cleanMs]
            ).catch(() => {}); // silenciar si la tabla aun no existe
        }
        res.sendStatus(204);
    } catch {
        res.sendStatus(204);
    }
});

app.post('/api/tracks/:id/like', authenticateToken, async (req: any, res: Response) => {

    try {

        const [exists]: any = await pool.execute('SELECT * FROM user_likes WHERE user_id = ? AND track_id = ?', [req.user.userId, req.params.id]);

        if (exists.length > 0) {

            await pool.execute('DELETE FROM user_likes WHERE user_id = ? AND track_id = ?', [req.user.userId, req.params.id]);

            res.json({ liked: false });

        } else {

            await pool.execute('INSERT INTO user_likes (user_id, track_id) VALUES (?, ?)', [req.user.userId, req.params.id]);

            res.json({ liked: true });

        }

    } catch (e) { res.status(500).send(); }

});



app.patch('/api/tracks/:id', authenticateToken, upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'animated_cover', maxCount: 1 }]), async (req: any, res: Response) => { 

    if (req.user.role !== 'admin' && req.user.role !== 'moderator') return res.status(403).json({ error: "Forbidden" });

    const { title, artist, album, track_number, tabs_url, video_url } = req.body;

    try {
        const [rows]: any = await pool.execute('SELECT cover_path, animated_cover_path FROM tracks WHERE id = ?', [req.params.id]);
        const oldCover = rows[0]?.cover_path || null;
        const oldAnimCover = rows[0]?.animated_cover_path || null;

        let coverPath = req.body.cover_path !== undefined ? normalizeMediaPath(req.body.cover_path) : normalizeMediaPath(oldCover);
        let animatedCoverPath = req.body.animated_cover_path !== undefined ? normalizeMediaPath(req.body.animated_cover_path) : normalizeMediaPath(oldAnimCover);

        if (req.files && req.files['cover']) {
            coverPath = `/uploads/${req.files['cover'][0].filename}`;
        }

        if (req.files && req.files['animated_cover']) {
            animatedCoverPath = `/uploads/${req.files['animated_cover'][0].filename}`;
        }

        const cleanT = (track_number === "" || track_number === "null" || track_number === "0") ? null : parseInt(track_number);

        await pool.execute(
            'UPDATE tracks SET title = ?, artist = ?, album = ?, track_number = ?, tabs_url = ?, video_url = ?, cover_path = ?, animated_cover_path = ? WHERE id = ?', 
            [title, artist, album, cleanT, tabs_url || null, video_url || null, coverPath, animatedCoverPath || null, req.params.id]
        );

        // Borrado seguro: solo después de actualizar la BD y solo si ninguna otra canción usa el archivo antiguo
        if (oldCover && normalizeMediaPath(oldCover) !== coverPath) {
            await unlinkTrackAssetIfUnused(oldCover, req.params.id);
        }
        if (oldAnimCover && normalizeMediaPath(oldAnimCover) !== animatedCoverPath) {
            await unlinkTrackAssetIfUnused(oldAnimCover, req.params.id);
        }

        // Sincronizar nuevas portadas con Backblaze B2 y limpiar archivo local
        if (isB2Configured()) {
            if (req.files && req.files['cover']?.[0]) {
                const c = req.files['cover'][0];
                await syncFileToB2(c.filename, c.path, c.mimetype, c.size);
            }
            if (req.files && req.files['animated_cover']?.[0]) {
                const ac = req.files['animated_cover'][0];
                await syncFileToB2(ac.filename, ac.path, ac.mimetype, ac.size);
            }
        }

        res.send(); 
    } catch (e) { 
        console.error("Error updating track:", e);
        res.status(500).send(); 
    }
});



app.post('/api/moderation/:id', authenticateToken, async (req: any, res: Response) => {

    if (req.user.role !== 'admin' && req.user.role !== 'moderator') return res.status(403).json({ error: "Forbidden" });

    try {

        if (req.body.status === 'rejected') {

            if (req.user.role !== 'admin') return res.status(403).json({ error: "Only admins can reject." });

            await deleteTrackFiles(req.params.id);

            await pool.execute('DELETE FROM tracks WHERE id = ?', [req.params.id]);

            return res.send({ message: "Deleted" });

        }

        await pool.execute('UPDATE tracks SET status = ? WHERE id = ?', [req.body.status, req.params.id]);

        res.send();

    } catch (e) { res.status(500).send(); }

});



app.delete('/api/tracks/:id', authenticateToken, async (req: any, res: Response) => { 

    try { 

        const [trackRows]: any = await pool.execute('SELECT added_by FROM tracks WHERE id = ?', [req.params.id]);

        if (trackRows.length === 0) return res.status(404).json({ error: "Not found" });

        

        // Permite borrar si es admin O si es el dueño que la acaba de subir

        if (req.user.role !== 'admin' && trackRows[0].added_by !== req.user.userId) {

            return res.status(403).json({ error: "Forbidden" });

        }



        await deleteTrackFiles(req.params.id);

        await pool.execute('DELETE FROM tracks WHERE id = ?', [req.params.id]); 

        res.send(); 

    } catch (e) { res.status(500).send(); } 

});



// --- ARTIST PROFILE & BIO ---

app.get('/api/artists/:name', async (req: Request, res: Response) => {

    try {

        const [rows]: any = await pool.execute('SELECT * FROM artists WHERE name = ?', [req.params.name]);

        if (rows.length > 0) {

            res.json(rows[0]);

        } else {

            res.json({ name: req.params.name, bio: null });

        }

    } catch (e) {

        res.status(500).json({ error: "Error fetching artist" });

    }

});



app.put('/api/artists/:name/bio', authenticateToken, async (req: any, res: Response) => {

    // Solo admins y moderadores pueden guardar/editar la biografía

    if (req.user.role !== 'admin' && req.user.role !== 'moderator') {

        return res.status(403).json({ error: "Forbidden" });

    }



    const { bio } = req.body;

    try {

        await pool.execute(

            'INSERT INTO artists (name, bio) VALUES (?, ?) ON DUPLICATE KEY UPDATE bio = VALUES(bio)',

            [req.params.name, bio]

        );

        res.json({ success: true, bio });

    } catch (e) {

        res.status(500).json({ error: "Error saving artist bio" });

    }

});



// SUBIR FOTO DE PERFIL DE ARTISTA

app.post('/api/artists/:name/image', authenticateToken, upload.single('image'), async (req: any, res: Response) => {

    if (req.user.role !== 'admin' && req.user.role !== 'moderator') return res.status(403).json({ error: "Forbidden" });

    if (!req.file) return res.status(400).json({ error: "No image uploaded" });



    const newImagePath = `/uploads/${req.file.filename}`;



    try {
        // Borramos la imagen vieja del disco y de B2 si ya tenía una
        const [rows]: any = await pool.execute('SELECT image_url FROM artists WHERE name = ?', [req.params.name]);
        if (rows.length > 0 && rows[0].image_url) {
            const oldPath = resolveDiskPath(rows[0].image_url);
            if (oldPath && fs.existsSync(oldPath)) {
                try { fs.unlinkSync(oldPath); } catch {}
            }
            if (isB2Configured()) {
                const oldFilename = path.basename(rows[0].image_url.split('?')[0]);
                deleteFromB2(oldFilename).catch(() => {});
            }
        }

        // Guardamos o actualizamos la foto en la base de datos
        await pool.execute(
            'INSERT INTO artists (name, image_url) VALUES (?, ?) ON DUPLICATE KEY UPDATE image_url = VALUES(image_url)',
            [req.params.name, newImagePath]
        );

        // Sincronizar nueva imagen a B2 y limpiar archivo local
        if (isB2Configured()) {
            await syncFileToB2(req.file.filename, req.file.path, req.file.mimetype, req.file.size);
        }

        res.json({ image_url: newImagePath });
    } catch (e) {

        console.error("Error subiendo foto de artista:", e);

        res.status(500).json({ error: "Error al guardar foto del artista" });

    }

});



// --- USERS & PROFILE ---

app.get('/api/users/me', authenticateToken, async (req: any, res: Response) => {

    try {

        // 1. Get user details

        const [userRows]: any = await pool.execute(

            'SELECT id, username, email, role, profile_pic_path, custom_bg_path FROM users WHERE id = ?', 

            [req.user.userId]

        );

        

        if (userRows.length === 0) return res.status(404).json({ error: "User not found" });



        // 2. Calculate contributions (tracks uploaded)

        const [trackRows]: any = await pool.execute(

            'SELECT COUNT(*) as count FROM tracks WHERE added_by = ?', 

            [req.user.userId]

        );

        

        // 3. Calculate library lists (playlists owned)

        const [playlistRows]: any = await pool.execute(

            'SELECT COUNT(*) as count FROM playlists WHERE owner_id = ?', 

            [req.user.userId]

        );



        // Return everything merged

        res.json({

            ...userRows[0],

            stats: {

                tracks: trackRows[0].count,

                playlists: playlistRows[0].count

            }

        });

    } catch (error) {

        console.error("Profile fetch error:", error);

        res.status(500).json({ error: "Server error fetching profile" });

    }

});



app.patch('/api/users/me/last-track', authenticateToken, async (req: any, res: Response) => {

  const { trackId } = req.body;



  try {

    if (trackId === null || trackId === undefined) {

      await pool.execute(

        'UPDATE users SET last_track_id = NULL WHERE id = ?',

        [req.user.userId]

      );



      return res.json({ success: true });

    }



    const [trackRows]: any = await pool.execute(

      'SELECT id FROM tracks WHERE id = ?',

      [trackId]

    );



    if (trackRows.length === 0) {

      return res.status(404).json({ error: "Track not found" });

    }



    await pool.execute(

      'UPDATE users SET last_track_id = ? WHERE id = ?',

      [trackId, req.user.userId]

    );



    res.json({ success: true });



  } catch (error) {

    console.error("Save last track error:", error);

    res.status(500).json({ error: "Server error saving last track" });

  }

});





app.get('/api/users/me/last-track', authenticateToken, async (req: any, res: Response) => {

  try {

    const [rows]: any = await pool.execute(`

      SELECT t.*

      FROM tracks t

      INNER JOIN users u ON u.last_track_id = t.id

      WHERE u.id = ?

    `, [req.user.userId]);



    if (rows.length === 0) {

      return res.json(null);

    }



    res.json(rows[0]);



  } catch (error) {

    console.error("Last track fetch error:", error);

    res.status(500).json({ error: "Server error fetching last track" });

  }

});



app.post('/api/users/profile-pic', authenticateToken, upload.single('profile_pic'), async (req: any, res: Response) => {

    try {

        if (!req.file) return res.status(400).json({ error: "No image uploaded" });



        const newPicPath = `/uploads/${req.file.filename}`;



        // Get current profile pic so we can delete the old file from the hard drive and B2
        const [userRows]: any = await pool.execute('SELECT profile_pic_path FROM users WHERE id = ?', [req.user.userId]);
        if (userRows[0]?.profile_pic_path) {
            const oldPath = resolveDiskPath(userRows[0].profile_pic_path);
            if (oldPath && fs.existsSync(oldPath)) {
                try { fs.unlinkSync(oldPath); } catch {}
            }
            if (isB2Configured()) {
                const oldFilename = path.basename(userRows[0].profile_pic_path.split('?')[0]);
                deleteFromB2(oldFilename).catch(() => {});
            }
        }

        // Update the database with the new image path
        await pool.execute('UPDATE users SET profile_pic_path = ? WHERE id = ?', [newPicPath, req.user.userId]);

        // Sync new picture to B2 and clean local file
        if (isB2Configured()) {
            await syncFileToB2(req.file.filename, req.file.path, req.file.mimetype, req.file.size);
        }
        
        res.json({ profile_pic_path: newPicPath });
    } catch (error) {
        console.error("Profile pic upload error:", error);
        res.status(500).json({ error: "Server error uploading profile pic" });
    }
});

app.post('/api/users/custom-bg', authenticateToken, upload.single('custom_bg'), async (req: any, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No image uploaded" });
        }

        const newBgPath = `/uploads/${req.file.filename}`;

        // Obtener el wallpaper anterior
        const [userRows]: any = await pool.execute(
            'SELECT custom_bg_path FROM users WHERE id = ?',
            [req.user.userId]
        );

        // Eliminar el wallpaper anterior del disco y de B2
        if (userRows[0]?.custom_bg_path) {
            const oldPath = resolveDiskPath(userRows[0].custom_bg_path);
            if (oldPath && fs.existsSync(oldPath)) {
                try { fs.unlinkSync(oldPath); } catch {}
            }
            if (isB2Configured()) {
                const oldFilename = path.basename(userRows[0].custom_bg_path.split('?')[0]);
                deleteFromB2(oldFilename).catch(() => {});
            }
        }

        // Guardar el nuevo wallpaper en la base de datos
        await pool.execute(
            'UPDATE users SET custom_bg_path = ? WHERE id = ?',
            [newBgPath, req.user.userId]
        );

        // Sincronizar nuevo wallpaper a B2 y limpiar archivo local
        if (isB2Configured()) {
            await syncFileToB2(req.file.filename, req.file.path, req.file.mimetype, req.file.size);
        }

        res.json({

            custom_bg_path: newBgPath

        });



    } catch (error) {

        console.error("Custom background upload error:", error);

        res.status(500).json({

            error: "Server error uploading custom background"

        });

    }

});



// --- PLAYLISTS & SESSIONS ---





app.get('/api/playlists', authenticateToken, async (req: any, res: Response) => {

    try {

        const [r] = await pool.execute(

            'SELECT * FROM playlists WHERE owner_id = ?',

            [req.user.userId]

        );



        res.json(r);

    } catch (e) {

        console.error("Get playlists error:", e);

        res.status(500).json({ error: "Error loading playlists" });

    }

});





app.post('/api/playlists', authenticateToken, async (req: any, res: Response) => {

    try {

        await pool.execute(

            'INSERT INTO playlists (name, owner_id) VALUES (?, ?)',

            [req.body.name, req.user.userId]

        );



        res.send();

    } catch (e) {

        console.error("Create playlist error:", e);

        res.status(500).json({ error: "Error creating playlist" });

    }

});





app.delete('/api/playlists/:id', authenticateToken, async (req: any, res: Response) => {

    try {

        await pool.execute(

            'DELETE FROM playlists WHERE id = ? AND owner_id = ?',

            [req.params.id, req.user.userId]

        );



        res.send();

    } catch (e) {

        console.error("Delete playlist error:", e);

        res.status(500).json({ error: "Error deleting playlist" });

    }

});





app.get('/api/playlists/:id/tracks', authenticateToken, async (req: any, res: Response) => {

    try {

        // Comprobar que la playlist pertenece al usuario

        const [playlistRows]: any = await pool.execute(

            'SELECT id FROM playlists WHERE id = ? AND owner_id = ?',

            [req.params.id, req.user.userId]

        );



        if (playlistRows.length === 0) {

            return res.status(403).json({ error: "Forbidden" });

        }



        // Obtener canciones respetando el orden personalizado

        const [t] = await pool.execute(`

            SELECT 

                t.*,

                (

                    SELECT COUNT(*)

                    FROM user_likes

                    WHERE track_id = t.id

                    AND user_id = ?

                ) as is_liked

            FROM tracks t

            JOIN playlist_tracks pt ON t.id = pt.track_id

            WHERE pt.playlist_id = ?

            ORDER BY pt.position ASC, pt.track_id ASC

        `, [

            req.user.userId,

            req.params.id

        ]);



        res.json(t);



    } catch (e) {

        console.error("Get playlist tracks error:", e);

        res.status(500).json({ error: "Error loading playlist tracks" });

    }

});





app.post('/api/playlists/:id/tracks', authenticateToken, async (req: any, res: Response) => {

    try {

        // Comprobar propiedad de la playlist

        const [playlistRows]: any = await pool.execute(

            'SELECT id FROM playlists WHERE id = ? AND owner_id = ?',

            [req.params.id, req.user.userId]

        );



        if (playlistRows.length === 0) {

            return res.status(403).json({ error: "Forbidden" });

        }



        // Evitar duplicados

        const [existingRows]: any = await pool.execute(

            'SELECT track_id FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',

            [req.params.id, req.body.trackId]

        );



        if (existingRows.length > 0) {

            return res.status(409).json({ error: "Track already in playlist" });

        }



        // Poner la canción al final

        const [positionRows]: any = await pool.execute(

            `SELECT COALESCE(MAX(position), -1) + 1 AS next_position

             FROM playlist_tracks

             WHERE playlist_id = ?`,

            [req.params.id]

        );



        const nextPosition = positionRows[0].next_position;



        await pool.execute(

            `INSERT INTO playlist_tracks (playlist_id, track_id, position)

             VALUES (?, ?, ?)`,

            [

                req.params.id,

                req.body.trackId,

                nextPosition

            ]

        );



        res.send();



    } catch (e) {

        console.error("Add track to playlist error:", e);

        res.status(500).json({ error: "Error adding track to playlist" });

    }

});





app.delete('/api/playlists/:id/tracks/:tid', authenticateToken, async (req: any, res: Response) => {

    try {

        // Comprobar propiedad de la playlist

        const [playlistRows]: any = await pool.execute(

            'SELECT id FROM playlists WHERE id = ? AND owner_id = ?',

            [req.params.id, req.user.userId]

        );



        if (playlistRows.length === 0) {

            return res.status(403).json({ error: "Forbidden" });

        }



        await pool.execute(

            `DELETE FROM playlist_tracks

             WHERE playlist_id = ?

             AND track_id = ?`,

            [

                req.params.id,

                req.params.tid

            ]

        );



        res.send();



    } catch (e) {

        console.error("Remove track from playlist error:", e);

        res.status(500).json({ error: "Error removing track from playlist" });

    }

});





app.patch('/api/playlists/:id/tracks/reorder', authenticateToken, async (req: any, res: Response) => {

    const { trackIds } = req.body;



    if (!Array.isArray(trackIds)) {

        return res.status(400).json({

            error: "trackIds must be an array"

        });

    }



    const connection = await pool.getConnection();



    try {

        // Comprobar propiedad de la playlist

        const [playlistRows]: any = await connection.execute(

            'SELECT id FROM playlists WHERE id = ? AND owner_id = ?',

            [req.params.id, req.user.userId]

        );



        if (playlistRows.length === 0) {
            // release() lo hace el finally
            return res.status(403).json({ error: "Forbidden" });

        }



        await connection.beginTransaction();



        // Actualizar posición de cada canción

        for (let i = 0; i < trackIds.length; i++) {

            await connection.execute(

                `UPDATE playlist_tracks

                 SET position = ?

                 WHERE playlist_id = ?

                 AND track_id = ?`,

                [

                    i,

                    req.params.id,

                    trackIds[i]

                ]

            );

        }



        await connection.commit();



        res.send();



    } catch (e) {

        await connection.rollback();



        console.error("Reorder playlist error:", e);



        res.status(500).json({

            error: "Error reordering playlist"

        });



    } finally {

        connection.release();

    }

});

app.post('/api/sessions/create', authenticateToken, async (req: any, res: Response) => { const c = Math.random().toString(36).substring(2, 8).toUpperCase(); await pool.execute('INSERT INTO sessions (code, host_id) VALUES (?, ?)', [c, req.user.userId]); scheduleSessionDeletion(c, NEVER_JOINED_GRACE_MS); res.json({ code: c }); });



// --- ESTADO DE SESIONES (en memoria) ---

// Guarda lo último que se sabe de cada sesión para poder ponerle al día a quien

// entra a mitad de una canción (p. ej. desde el botón de Discord).

type SessionState = {

    song: any | null;

    songId: string | null;

    queue: any[];

    isPlaying: boolean;

    position: number;      // segundos, válida en el instante updatedAt

    updatedAt: number;     // Date.now() del servidor (así no depende del reloj de los clientes)

    isShuffle: boolean;

    shuffledQueue: any[];

    isLoop: boolean;

};

const sessionStates = new Map<string, SessionState>();



const getSessionState = (code: string): SessionState => {

    let st = sessionStates.get(code);

    if (!st) {

        st = { song: null, songId: null, queue: [], isPlaying: false, position: 0, updatedAt: Date.now(), isShuffle: false, shuffledQueue: [], isLoop: false };

        sessionStates.set(code, st);

    }

    return st;

};



const livePosition = (st: SessionState) =>

    st.isPlaying ? st.position + (Date.now() - st.updatedAt) / 1000 : st.position;



const snapshot = (code: string) => {

    const st = sessionStates.get(code);

    return st ? { ...st, position: livePosition(st) } : null;

};



const trackCommand = (code: string, command: string, data: any) => {

    const st = getSessionState(code);

    const now = Date.now();

    switch (command) {

        case 'play-track': {

            if (Array.isArray(data?.queue)) st.queue = data.queue;

            if (data?.song?.id) {

                const sameSong = st.songId === data.song.id;

                st.song = data.song;

                st.songId = data.song.id;

                if (!sameSong) st.isPlaying = true;

                st.position = Number(data.position) || 0;

                st.updatedAt = now;

            }

            break;

        }

        case 'sync-time':

            if (data?.songId && data.songId === st.songId) {

                st.position = Number(data.position) || 0;

                st.updatedAt = now;

            }

            break;

        case 'seek':

            st.position = Number(data?.time) || 0;

            st.updatedAt = now;

            break;

        case 'toggle-play':

            st.position = livePosition(st);

            st.isPlaying = !!data?.isPlaying;

            st.updatedAt = now;

            break;

        case 'toggle-shuffle':

            st.isShuffle = !!data?.isShuffle;

            st.shuffledQueue = Array.isArray(data?.shuffledQueue) ? data.shuffledQueue : [];

            break;

        case 'toggle-loop':

            st.isLoop = !!data?.isLoop;

            break;

    }

};



// Limpieza de sesiones que llevan horas sin actividad y sin nadie dentro.

setInterval(() => {

    const limit = Date.now() - 6 * 60 * 60 * 1000;

    for (const [code, st] of sessionStates) {

        if (st.updatedAt < limit && !io.sockets.adapter.rooms.get(code)) sessionStates.delete(code);

    }

}, 30 * 60 * 1000);



// --- BORRADO DE SESIONES VACÍAS ---

// Cuando no queda nadie en la sala, se espera un margen (por si alguien se reconecta

// o recarga la página) y después se borra la fila de la BD y el estado en memoria.

const EMPTY_GRACE_MS = 60 * 1000;        // margen tras quedarse vacía

const NEVER_JOINED_GRACE_MS = 2 * 60 * 1000; // margen para sesiones recién creadas

const SESSION_CODE_RE = /^[A-Z0-9]{4,10}$/;

const deleteTimers = new Map<string, NodeJS.Timeout>();

const roomSize = (code: string) => io.sockets.adapter.rooms.get(code)?.size ?? 0;



const cancelSessionDeletion = (code: string) => {

    const t = deleteTimers.get(code);

    if (t) { clearTimeout(t); deleteTimers.delete(code); }

};



const scheduleSessionDeletion = (code: string, delay = EMPTY_GRACE_MS) => {

    cancelSessionDeletion(code);

    deleteTimers.set(code, setTimeout(async () => {

        deleteTimers.delete(code);

        if (roomSize(code) > 0) return; // alguien volvió a entrar

        try {

            await pool.execute('DELETE FROM sessions WHERE code = ?', [code]);

            sessionStates.delete(code);

        } catch (err) {

            console.error('delete empty session error:', err);

        }

    }, delay));

};



// Al arrancar: sesiones que quedaron huérfanas de antes (o tras un reinicio).

setTimeout(async () => {

    try {

        const [rows]: any = await pool.execute('SELECT code FROM sessions');

        for (const r of rows) scheduleSessionDeletion(r.code, NEVER_JOINED_GRACE_MS);

    } catch (err) {

        console.error('startup session cleanup error:', err);

    }

}, 10 * 1000);



// --- PRESENCIA EN SESIONES ---

// Cada socket guarda con qué usuario entró a cada sala (socket.data.sessionUsers).

// Los miembros se deducen de las salas de socket.io, deduplicando por userId

// (así una misma persona con dos pestañas cuenta una sola vez).

type Member = { userId: string; username: string; avatar: string | null; isHost: boolean };

const sessionHosts = new Map<string, string>(); // code -> host userId

const pendingLeaves = new Map<string, NodeJS.Timeout>(); // `${code}:${userId}` -> aviso de salida diferido

const LEAVE_ANNOUNCE_DELAY_MS = 8000; // por si solo es una recarga / reconexión



const cleanUser = (u: any) => ({

    userId: String(u?.userId ?? u?.id ?? ''),

    username: String(u?.username ?? 'Alguien').slice(0, 40),

    avatar: (u?.profile_pic_path ?? null) as string | null,

});



const getMembers = (code: string): Member[] => {

    const ids = io.sockets.adapter.rooms.get(code);

    const seen = new Map<string, Member>();

    if (ids) for (const id of ids) {

        const u = io.sockets.sockets.get(id)?.data?.sessionUsers?.[code];

        if (u && u.userId && !seen.has(u.userId)) seen.set(u.userId, { ...u, isHost: u.userId === sessionHosts.get(code) });

    }

    // Anfitrión primero, luego por nombre

    return [...seen.values()].sort((a, b) => Number(b.isHost) - Number(a.isHost) || a.username.localeCompare(b.username));

};



const broadcastMembers = (code: string) => io.to(code).emit('session-members', { code, members: getMembers(code) });

const systemChat = (code: string, message: string, kind: 'join' | 'leave' | 'info' = 'info') =>

    io.to(code).emit('receive-chat', { system: true, kind, message, time: new Date() });

const userStillInRoom = (code: string, userId: string) => getMembers(code).some(m => m.userId === userId);



// Anuncia la salida de un usuario. Si fue una desconexión, espera unos segundos

// y solo avisa si no ha vuelto a entrar (evita spam en recargas).

const announceLeave = (code: string, u: { userId: string; username: string }, delayed: boolean) => {

    const key = `${code}:${u.userId}`;

    const doIt = () => {

        pendingLeaves.delete(key);

        broadcastMembers(code);

        if (!userStillInRoom(code, u.userId)) systemChat(code, `${u.username} ha salido de la sesión 👋`, 'leave');

    };

    if (!delayed) return doIt();

    broadcastMembers(code);

    if (pendingLeaves.has(key)) clearTimeout(pendingLeaves.get(key)!);

    pendingLeaves.set(key, setTimeout(doIt, LEAVE_ANNOUNCE_DELAY_MS));

};



io.on('connection', (socket) => {

    socket.on('identify', (uid) => { socket.join(`user_${uid}`); });



    // Unirse a una sesión. Valida que el código exista y responde con un "ack"

    // que incluye el estado actual (canción, posición, cola...) para sincronizar.

    socket.on('join-session', async (payload: any, ack?: (res: any) => void) => {

        const reply = typeof ack === 'function' ? ack : () => {};

        try {

            const code = String(payload?.code ?? '').trim().toUpperCase();

            if (!/^[A-Z0-9]{4,10}$/.test(code)) return reply({ ok: false, error: 'INVALID_CODE' });



            const [rows]: any = await pool.execute('SELECT code, host_id FROM sessions WHERE code = ?', [code]);

            if (!rows.length) return reply({ ok: false, error: 'SESSION_NOT_FOUND' });

            sessionHosts.set(code, String(rows[0].host_id));



            const u = cleanUser(payload?.user);

            if (!u.userId) return reply({ ok: false, error: 'INVALID_USER' });

            // Foto y nombre se leen de la BD (no se fía del cliente).

            const [urows]: any = await pool.execute('SELECT username, profile_pic_path FROM users WHERE id = ?', [u.userId]);

            if (urows[0]) { u.username = String(urows[0].username).slice(0, 40); u.avatar = urows[0].profile_pic_path || null; }



            const wasIn = userStillInRoom(code, u.userId);     // ya estaba (otra pestaña)

            const key = `${code}:${u.userId}`;

            const wasPendingLeave = pendingLeaves.has(key);    // vuelve tras una recarga/reconexión

            if (wasPendingLeave) { clearTimeout(pendingLeaves.get(key)!); pendingLeaves.delete(key); }



            socket.data.sessionUsers = { ...(socket.data.sessionUsers ?? {}), [code]: u };

            socket.join(code);

            cancelSessionDeletion(code);



            broadcastMembers(code);

            io.to(code).emit('user-joined', payload?.user);

            if (!wasIn && !wasPendingLeave) {

                systemChat(code, `${u.username} ha entrado a la sesión. ¡Saludad! 👋`, 'join');

            }

            const list = getMembers(code);

            reply({ ok: true, code, members: list.length, membersList: list, state: snapshot(code) });

        } catch (err) {

            console.error('join-session error:', err);

            reply({ ok: false, error: 'SERVER_ERROR' });

        }

    });



    socket.on('leave-session', ({ code }: any = {}) => {

        if (!code) return;

        const c = String(code).toUpperCase();

        const u = socket.data.sessionUsers?.[c];

        socket.leave(c);

        if (socket.data.sessionUsers) delete socket.data.sessionUsers[c];

        if (u) announceLeave(c, u, false);

        if (SESSION_CODE_RE.test(c) && roomSize(c) === 0) scheduleSessionDeletion(c);

    });



    // Desconexión (cerrar pestaña, perder red...): el socket aún figura en sus salas.

    socket.on('disconnecting', () => {

        for (const room of socket.rooms) {

            if (!SESSION_CODE_RE.test(room)) continue;

            if (roomSize(room) <= 1) scheduleSessionDeletion(room);

            const u = socket.data.sessionUsers?.[room];

            if (u) {

                // El socket sigue en la sala en este evento: lo quitamos ya para que la lista sea correcta.

                socket.leave(room);

                delete socket.data.sessionUsers[room];

                announceLeave(room, u, true);

            }

        }

    });



    // Re-sincronizar bajo demanda (p. ej. al darle a play tras un autoplay bloqueado).

    socket.on('get-session-state', ({ code }: any = {}, ack?: (res: any) => void) => {

        const c = String(code ?? '').toUpperCase();

        if (typeof ack === 'function') ack({ ok: socket.rooms.has(c), state: snapshot(c) });

    });



    // Comandos que cambian lo que suena para todos: solo el anfitrión puede darlos.

    // El resto de la sesión solo escucha, así no hay peleas por el control.

    const HOST_ONLY_COMMANDS = new Set(['play-track', 'toggle-play', 'seek', 'toggle-shuffle', 'toggle-loop', 'sync-time']);

    socket.on('send-command', ({ code, command, data }) => {

        if (!code || !socket.rooms.has(code)) return; // solo miembros de la sala

        if (HOST_ONLY_COMMANDS.has(command)) {

            const u = socket.data.sessionUsers?.[code];

            if (!u || sessionHosts.get(code) !== u.userId) return; // no es el anfitrión: se ignora

        }

        trackCommand(code, command, data);

        socket.to(code).emit('receive-command', { command, data });

    });



    // Ceder el control a otra persona de la sesión. Solo puede hacerlo el anfitrión actual.

    socket.on('transfer-host', async ({ code, targetUserId }: any = {}, ack?: (res: any) => void) => {

        const reply = typeof ack === 'function' ? ack : () => {};

        try {

            const c = String(code ?? '').trim().toUpperCase();

            const caller = socket.data.sessionUsers?.[c];

            if (!caller) return reply({ ok: false, error: 'NOT_IN_SESSION' });

            if (sessionHosts.get(c) !== caller.userId) return reply({ ok: false, error: 'NOT_HOST' });



            const target = String(targetUserId ?? '');

            if (!target || !userStillInRoom(c, target)) return reply({ ok: false, error: 'TARGET_NOT_IN_SESSION' });



            sessionHosts.set(c, target);

            await pool.execute('UPDATE sessions SET host_id = ? WHERE code = ?', [target, c]);



            broadcastMembers(c);

            const newHost = getMembers(c).find(m => m.userId === target);

            systemChat(c, `${newHost?.username ?? 'Alguien'} es ahora el anfitrión de la sesión 👑`, 'info');

            reply({ ok: true });

        } catch (err) {

            console.error('transfer-host error:', err);

            reply({ ok: false, error: 'SERVER_ERROR' });

        }

    });

    socket.on('send-chat', ({ code, user, message }) => {

        const text = String(message ?? '').trim().slice(0, 500);

        if (!code || !text || !socket.rooms.has(code)) return; // solo miembros, sin mensajes vacíos

        io.to(code).emit('receive-chat', { user: socket.data.sessionUsers?.[code] ?? user, message: text, time: new Date() });

    });

    socket.on('send-private-message', ({ sender, receiverId, message }) => { io.to(`user_${receiverId}`).emit('receive-private-message', { sender_id: sender.userId, receiver_id: receiverId, message, created_at: new Date() }); });

    socket.on('send-session-invite', ({ senderName, receiverId, code }) => { io.to(`user_${receiverId}`).emit('receive-session-invite', { from: senderName, code }); });

});

// --- RUTA API PARA PURGAR Y UNIFICAR PORTADAS DE ÁLBUMES ---
app.post('/api/admin/purge-album-covers', authenticateToken, async (req: any, res: Response) => {
    if (req.user.role !== 'admin' && req.user.role !== 'moderator') {
        return res.status(403).json({ error: "Forbidden: Admins only" });
    }

    let albumsCount = 0;
    let updatedTracksCount = 0;
    let deletedFilesCount = 0;

    try {
        console.log(`💿 Iniciando purga y normalización inteligente de álbumes...`);
        const b2FilesSet = isB2Configured() ? new Set(await listB2Files()) : new Set<string>();

        const [albums]: any = await pool.execute(`
            SELECT DISTINCT artist, album 
            FROM tracks 
            WHERE album IS NOT NULL AND album != '' AND album != 'Unknown Album'
        `);

        albumsCount = albums.length;

        const hasValidMediaAsset = (mediaPath?: string | null): boolean => {
            if (!mediaPath || mediaPath === '') return false;
            const diskPath = resolveDiskPath(mediaPath);
            if (diskPath && fs.existsSync(diskPath)) return true;
            const filename = path.basename(String(mediaPath).split('?')[0]);
            return Boolean(filename && b2FilesSet.has(filename));
        };

        for (const item of albums) {
            const { artist, album } = item;
            
            // Obtenemos todas las pistas del álbum. 
            // Ordenamos inteligentemente: primero las que tienen track_number válido y cover_path no nulo.
            const [tracks]: any = await pool.execute(`
                SELECT id, title, track_number, cover_path, animated_cover_path 
                FROM tracks 
                WHERE artist = ? AND album = ? 
                ORDER BY 
                    CASE WHEN cover_path IS NOT NULL AND cover_path != '' THEN 0 ELSE 1 END,
                    CASE WHEN track_number IS NOT NULL AND track_number > 0 THEN track_number ELSE 9999 END ASC,
                    id ASC
            `, [artist, album]);

            if (tracks.length <= 1) continue;

            // Elegimos como maestra la primera pista cuya portada EXISTA físicamente en el disco duro o en Backblaze B2
            const masterTrack = tracks.find((t: any) => hasValidMediaAsset(t.cover_path));
            if (!masterTrack) continue; // Si ninguna canción del álbum tiene portada válida, no destruimos nada

            const masterCover = normalizeMediaPath(masterTrack.cover_path);
            const masterAnimTrack = tracks.find((t: any) => hasValidMediaAsset(t.animated_cover_path));
            const masterAnimCover = masterAnimTrack ? normalizeMediaPath(masterAnimTrack.animated_cover_path) : null;

            if (masterTrack.cover_path !== masterCover) {
                await pool.execute('UPDATE tracks SET cover_path = ? WHERE id = ?', [masterCover, masterTrack.id]);
            }

            // Aplicamos la portada maestra a TODAS las demás pistas del álbum
            for (let i = 0; i < tracks.length; i++) {
                const currentTrack = tracks[i];
                if (currentTrack.id === masterTrack.id) continue;

                const oldCover = currentTrack.cover_path;
                const oldAnim = currentTrack.animated_cover_path;

                const newCover = masterCover;
                const newAnimCover = masterAnimCover || normalizeMediaPath(oldAnim);

                const coverChanged = normalizeMediaPath(oldCover) !== newCover;
                const animChanged = Boolean(masterAnimCover && normalizeMediaPath(oldAnim) !== masterAnimCover);

                if (coverChanged || animChanged) {
                    await pool.execute(
                        'UPDATE tracks SET cover_path = ?, animated_cover_path = ? WHERE id = ?',
                        [newCover, newAnimCover, currentTrack.id]
                    );
                    updatedTracksCount++;

                    if (coverChanged && oldCover) {
                        const deleted = await unlinkTrackAssetIfUnused(oldCover, currentTrack.id);
                        if (deleted) deletedFilesCount++;
                    }
                    if (animChanged && oldAnim) {
                        const deleted = await unlinkTrackAssetIfUnused(oldAnim, currentTrack.id);
                        if (deleted) deletedFilesCount++;
                    }
                }
            }
        }

        res.json({
            success: true,
            albumsProcessed: albumsCount,
            processedAlbums: albumsCount,
            updatedTracks: updatedTracksCount,
            tracksUpdated: updatedTracksCount,
            deletedFiles: deletedFilesCount,
            filesDeleted: deletedFilesCount
        });

    } catch (error) {
        console.error("❌ Error en la purga inteligente:", error);
        res.status(500).json({ error: "Error interno al purgar portadas" });
    }
});

// Auto-reparación de portadas perdidas (extrae del FLAC/MP3 en disco o Backblaze B2, o descarga de iTunes SOLO si el archivo no existe en ningún sitio)
const healInFlight = new Map<string, Promise<string | null>>();

const streamToBuffer = async (stream: NodeJS.ReadableStream, maxBytes = 2 * 1024 * 1024): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    let total = 0;
    return new Promise((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            chunks.push(buf);
            total += buf.length;
            if (total >= maxBytes) {
                try { (stream as any).destroy?.(); } catch {}
                resolve(Buffer.concat(chunks));
            }
        });
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', (err) => {
            if (chunks.length > 0) resolve(Buffer.concat(chunks));
            else reject(err);
        });
    });
};

const getJpegDimensions = (buf: Buffer | null): { width: number; height: number } | null => {
    if (!buf || buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
    let i = 2;
    while (i + 9 < buf.length) {
        if (buf[i] !== 0xFF) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xFF) { i++; continue; }
        if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xC0 && marker <= 0xC3) {
            return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
    }
    return null;
};

const extractEmbeddedCoverFromTrackAudio = async (track: any): Promise<Buffer | null> => {
    if (!track?.file_path) return null;
    try {
        const mm: any = await import('music-metadata');
        const audioDiskPath = resolveDiskPath(track.file_path);
        if (audioDiskPath && fs.existsSync(audioDiskPath)) {
            const meta = await mm.parseFile(audioDiskPath, { skipCovers: false });
            const pic = meta?.common?.picture?.[0];
            if (pic?.data && pic.data.length > 0) {
                return Buffer.from(pic.data);
            }
        }
        if (isB2Configured()) {
            const audioFilename = path.basename(String(track.file_path).split('?')[0]);
            if (audioFilename && audioFilename !== '.' && audioFilename !== '..') {
                const b2Obj = await getB2ObjectStream(audioFilename, 'bytes=0-2097151');
                if (b2Obj?.stream) {
                    const headerBuf = await streamToBuffer(b2Obj.stream, 2 * 1024 * 1024);
                    const ext = path.extname(audioFilename).toLowerCase();
                    const mimeType = ext === '.flac' ? 'audio/flac' : 'audio/mpeg';
                    const meta = await mm.parseBuffer(headerBuf, { mimeType }, { skipCovers: false });
                    const pic = meta?.common?.picture?.[0];
                    if (pic?.data && pic.data.length > 0) {
                        return Buffer.from(pic.data);
                    }
                }
            }
        }
    } catch {}
    return null;
};

const healTrackCoverToDisk = async (track: any, knownMissingInB2 = false): Promise<string | null> => {
    const rawCover = track.cover_path ? String(track.cover_path).trim() : '';
    const existingDisk = rawCover ? resolveDiskPath(rawCover) : null;
    if (existingDisk && fs.existsSync(existingDisk)) {
        const norm = normalizeMediaPath(rawCover);
        if (norm && norm !== rawCover) {
            await pool.execute('UPDATE tracks SET cover_path = ? WHERE id = ?', [norm, track.id]);
        }
        return existingDisk;
    }

    const filename = rawCover
        ? path.basename(rawCover.split('?')[0])
        : `healed-${track.id}-${Date.now()}.jpg`;
    const destPath = path.join(uploadDir, filename);
    const normalizedDbPath = `/uploads/${filename}`;

    if (healInFlight.has(filename)) {
        return healInFlight.get(filename)!;
    }

    const job = (async (): Promise<string | null> => {
        try {
            // 0. Si Backblaze B2 está activo y aún no hemos comprobado si la portada existe en B2,
            // verificar primero en B2 para NUNCA pisar una portada sana con una de iTunes.
            if (rawCover && isB2Configured() && !knownMissingInB2) {
                const existsInB2 = await checkB2FileExists(filename);
                if (existsInB2) {
                    const norm = normalizeMediaPath(rawCover);
                    if (norm && norm !== rawCover) {
                        await pool.execute('UPDATE tracks SET cover_path = ? WHERE id = ?', [norm, track.id]);
                    }
                    return normalizedDbPath;
                }
            }

            // 1. Intentar extraer la carátula embebida del propio archivo de audio (.flac / .mp3) en disco o Backblaze B2
            const embeddedPic = await extractEmbeddedCoverFromTrackAudio(track);
            if (embeddedPic && embeddedPic.length > 0) {
                fs.writeFileSync(destPath, embeddedPic);
                await pool.execute('UPDATE tracks SET cover_path = ? WHERE id = ?', [normalizedDbPath, track.id]);
                console.log(`🎨 Portada restaurada desde audio embebido para "${track.title}" -> ${filename}`);
                return destPath;
            }

            // 2. Fallback: descargar carátula de alta resolución desde iTunes API
            const queries = [
                `${track.artist || ''} ${track.title || ''}`.trim(),
                `${track.artist || ''} ${track.album || ''}`.trim()
            ].filter(Boolean);

            for (const q of queries) {
                try {
                    const searchRes = await axios.get('https://itunes.apple.com/search', {
                        params: { term: q, entity: 'song', limit: 5 },
                        timeout: 10000
                    });
                    const results: any[] = searchRes.data?.results || [];
                    const match = results.find((r) => r.artworkUrl100) || results[0];
                    if (match?.artworkUrl100) {
                        const artworkUrl = String(match.artworkUrl100).replace('100x100bb', '600x600bb');
                        const imgRes = await axios.get(artworkUrl, {
                            responseType: 'arraybuffer',
                            timeout: 12000,
                            headers: { 'User-Agent': 'Mozilla/5.0 (AuraMusic/2.0)' }
                        });
                        if (imgRes.data && imgRes.data.byteLength > 0) {
                            fs.writeFileSync(destPath, Buffer.from(imgRes.data));
                            await pool.execute('UPDATE tracks SET cover_path = ? WHERE id = ?', [normalizedDbPath, track.id]);
                            console.log(`🌐 Portada restaurada desde iTunes para "${track.title}" -> ${filename}`);
                            return destPath;
                        }
                    }
                } catch {}
            }
        } catch (err) {
            console.warn(`No se pudo auto-restaurar portada de "${track.title}":`, err);
        } finally {
            healInFlight.delete(filename);
        }
        return null;
    })();

    healInFlight.set(filename, job);
    return job;
};

// Localiza el archivo default-cover.jpg (o "default cover.jpg") en uploads
const resolveDefaultCoverDiskPath = (): string | null => {
    const candidates = ['default_cover.jpg', 'default-cover.jpg', 'default cover.jpg', 'default-cover.png', 'default-cover.webp'];
    const dirs = [
        uploadDir,
        path.join(ROOT_DIR, 'public', 'uploads'),
        path.join(DIST_DIR, 'uploads'),
        path.join(ROOT_DIR, 'public'),
        DIST_DIR
    ];
    for (const d of dirs) {
        for (const name of candidates) {
            const p = path.join(d, name);
            if (fs.existsSync(p)) return p;
        }
    }
    return null;
};

const readCurrentCoverBytes = async (coverFilename: string, diskPath: string | null): Promise<Buffer | null> => {
    try {
        if (diskPath && fs.existsSync(diskPath)) {
            return fs.readFileSync(diskPath);
        }
        if (isB2Configured() && coverFilename) {
            const b2Obj = await getB2ObjectStream(coverFilename);
            if (b2Obj?.stream) {
                return await streamToBuffer(b2Obj.stream, 5 * 1024 * 1024);
            }
        }
    } catch {}
    return null;
};

const healMissingCoversOnStartup = async () => {
    try {
        const [tracks]: any = await pool.execute('SELECT id, title, artist, album, file_path, cover_path FROM tracks');
        let healedCount = 0;
        let restoredEmbeddedCount = 0;
        const defaultCoverDisk = resolveDefaultCoverDiskPath();
        const defaultCoverDbPath = defaultCoverDisk ? `/uploads/${path.basename(defaultCoverDisk)}` : '/uploads/default-cover.jpg';

        // Consultar de una sola vez qué archivos existen en Backblaze B2 (con fallback si la key no tiene permiso de listado)
        let b2FilesSet = new Set<string>();
        let b2ListSucceeded = false;
        if (isB2Configured()) {
            try {
                b2FilesSet = new Set(await listB2Files());
                b2ListSucceeded = true;
            } catch (err: any) {
                console.warn('⚠️ No se pudo listar el bucket B2 de una vez, se comprobará archivo por archivo:', err?.message || err);
            }
        }

        // 1. Restauración única de portadas que habían sido sobrescritas por el fallback de iTunes (600x600)
        // extrayendo la portada original embebida directamente del archivo .flac/.mp3 (en disco o B2)
        // y eliminando la portada antigua de iTunes tanto del disco como del bucket de Backblaze B2.
        const embeddedRestoreMarker = path.join(uploadDir, '.b2-embedded-covers-restored-v2');
        if (!fs.existsSync(embeddedRestoreMarker)) {
            console.log('🔍 Verificando portadas sobrescritas por iTunes (600x600) para restaurar desde los archivos .flac/.mp3...');
            const tracksByCover = new Map<string, any[]>();
            for (const t of tracks || []) {
                if (t.cover_path) {
                    const list = tracksByCover.get(t.cover_path) || [];
                    list.push(t);
                    tracksByCover.set(t.cover_path, list);
                }
            }

            const entries = Array.from(tracksByCover.entries());
            const CONCURRENCY = 4;
            for (let i = 0; i < entries.length; i += CONCURRENCY) {
                const batch = entries.slice(i, i + CONCURRENCY);
                await Promise.all(batch.map(async ([oldCoverPath, groupTracks]) => {
                    const sampleTrack = groupTracks[0];
                    try {
                        const oldFilename = path.basename(String(oldCoverPath).split('?')[0]);
                        if (!oldFilename || oldFilename.startsWith('emb-') || /default[-_\s]?cover/i.test(oldFilename)) return;

                        const diskPath = resolveDiskPath(oldCoverPath);
                        const currBytes = await readCurrentCoverBytes(oldFilename, diskPath);
                        const dims = getJpegDimensions(currBytes);
                        const isItunes600 = dims && dims.width === 600 && dims.height === 600;
                        if (currBytes && !isItunes600) return;

                        let embeddedPic: Buffer | null = null;
                        for (const candidate of groupTracks.slice(0, 3)) {
                            embeddedPic = await extractEmbeddedCoverFromTrackAudio(candidate);
                            if (embeddedPic && embeddedPic.length > 0 && (!currBytes || Math.abs(embeddedPic.length - currBytes.length) > 64)) {
                                break;
                            }
                        }
                        if (!embeddedPic || embeddedPic.length === 0) return;
                        if (currBytes && Math.abs(embeddedPic.length - currBytes.length) <= 64) return;

                        const newFilename = `emb-${sampleTrack.id}-${Date.now()}.jpg`;
                        const newDiskPath = path.join(uploadDir, newFilename);
                        const newDbPath = `/uploads/${newFilename}`;

                        fs.writeFileSync(newDiskPath, embeddedPic);
                        if (isB2Configured()) {
                            await uploadToB2(newFilename, embeddedPic, 'image/jpeg', embeddedPic.length);
                            b2FilesSet.add(newFilename);
                        }
                        await pool.execute('UPDATE tracks SET cover_path = ? WHERE cover_path = ?', [newDbPath, oldCoverPath]);

                        // Eliminar la portada antigua de iTunes del disco local y del bucket Backblaze B2
                        if (diskPath && fs.existsSync(diskPath)) {
                            try {
                                fs.unlinkSync(diskPath);
                            } catch {}
                        }
                        if (isB2Configured()) {
                            await deleteFromB2(oldFilename).catch(() => {});
                            b2FilesSet.delete(oldFilename);
                        }

                        restoredEmbeddedCount++;
                        console.log(`🎨 Restaurada portada original desde audio (${sampleTrack.album || sampleTrack.title}) -> ${newFilename} (borrada antigua: ${oldFilename})`);
                    } catch (err: any) {
                        console.warn(`Aviso restaurando portada embebida de "${sampleTrack?.title}":`, err?.message || err);
                    }
                }));
            }

            try {
                fs.writeFileSync(embeddedRestoreMarker, new Date().toISOString());
            } catch {}
            if (restoredEmbeddedCount > 0) {
                console.log(`✅ Restauración desde audio completada: ${restoredEmbeddedCount} portadas originales recuperadas y portadas de iTunes eliminadas.`);
            }
        }

        // Recargar lista tras posibles actualizaciones de cover_path
        const [freshTracks]: any = await pool.execute('SELECT id, title, artist, album, file_path, cover_path FROM tracks');

        for (const track of freshTracks || []) {
            if (track.cover_path && String(track.cover_path).includes('/uploads/') && String(track.cover_path).startsWith('http')) {
                const norm = normalizeMediaPath(track.cover_path);
                if (norm) {
                    await pool.execute('UPDATE tracks SET cover_path = ? WHERE id = ?', [norm, track.id]);
                    track.cover_path = norm;
                }
            }

            const coverFilename = track.cover_path
                ? path.basename(String(track.cover_path).split('?')[0])
                : null;
            const diskPath = track.cover_path ? resolveDiskPath(track.cover_path) : null;
            const existsOnDisk = Boolean(diskPath && fs.existsSync(diskPath));
            const existsInB2 = Boolean(
                coverFilename &&
                isB2Configured() &&
                (b2ListSucceeded ? b2FilesSet.has(coverFilename) : await checkB2FileExists(coverFilename))
            );

            if (existsInB2 || existsOnDisk) {
                continue;
            }

            const restored = await healTrackCoverToDisk(track, true);
            if (restored) {
                if (isB2Configured() && fs.existsSync(restored)) {
                    await syncFileToB2(path.basename(restored), restored, 'image/jpeg', undefined, false);
                }
                healedCount++;
            } else if (defaultCoverDisk) {
                await pool.execute('UPDATE tracks SET cover_path = ? WHERE id = ?', [defaultCoverDbPath, track.id]);
                console.log(`🖼️ Asignada portada por defecto (${defaultCoverDbPath}) a "${track.title}"`);
            }
            await new Promise((r) => setTimeout(r, 200));
        }
        if (healedCount > 0) {
            console.log(`✨ Auto-reparación completada: ${healedCount} portadas recuperadas en ${uploadDir}`);
        }
    } catch (e) {
        console.warn("Aviso en auto-reparación inicial de portadas:", e);
    }
};

// Soportar tanto /default-cover.jpg como /uploads/default-cover.jpg
app.get(['/default_cover.jpg', '/default-cover.jpg', '/uploads/default_cover.jpg', '/uploads/default-cover.jpg', '/uploads/default%20cover.jpg'], async (req, res, next) => {
    const fallback = resolveDefaultCoverDiskPath();
    if (fallback && fs.existsSync(fallback)) {
        return res.sendFile(fallback);
    }
    if (isB2Configured()) {
        try {
            const b2Obj = await getB2ObjectStream('default_cover.jpg');
            if (b2Obj?.stream) {
                res.setHeader('Content-Type', b2Obj.contentType || 'image/jpeg');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                return b2Obj.stream.pipe(res);
            }
        } catch {}
    }
    next();
});



// Endpoint de miniaturas responsivas para portadas:
// Intercepta peticiones /uploads/:filename?w=... antes de que express.static devuelva el archivo original gigante.
// Permite que móviles y pantallas de distintas densidades carguen exactamente la resolución que necesitan.
const thumbsDir = path.join(uploadDir, 'thumbs');
if (!fs.existsSync(thumbsDir)) {
    try { fs.mkdirSync(thumbsDir, { recursive: true }); } catch {}
}

const ALLOWED_THUMB_WIDTHS = [150, 300, 480, 600, 800, 1000, 1200];

// Limitar concurrencia de procesamiento de imágenes con Sharp para no saturar los hilos de libuv
// ni quitarle CPU o I/O a las peticiones de streaming de audio.
let activeThumbJobs = 0;
const MAX_CONCURRENT_THUMBS = 6;
const thumbWaitQueue: (() => void)[] = [];
const acquireThumbSlot = (): Promise<void> => {
    if (activeThumbJobs < MAX_CONCURRENT_THUMBS) {
        activeThumbJobs++;
        return Promise.resolve();
    }
    return new Promise((resolve) => thumbWaitQueue.push(resolve));
};
const releaseThumbSlot = () => {
    activeThumbJobs--;
    const next = thumbWaitQueue.shift();
    if (next) {
        activeThumbJobs++;
        next();
    }
};

// Deduplicar peticiones simultáneas de la misma miniatura
const thumbJobsInFlight = new Map<string, Promise<Buffer | null>>();

const generateThumbnailBuffer = async (filename: string, targetWidth: number, cachedThumbPath: string): Promise<Buffer | null> => {
    const jobKey = `${filename}_w${targetWidth}`;
    const existingJob = thumbJobsInFlight.get(jobKey);
    if (existingJob) return existingJob;

    const job = (async (): Promise<Buffer | null> => {
        await acquireThumbSlot();
        try {
            if (fs.existsSync(cachedThumbPath)) {
                return await fs.promises.readFile(cachedThumbPath);
            }

            let sourceBuffer: Buffer | null = null;
            const localSourcePath = resolveDiskPath(filename);

            if (localSourcePath && fs.existsSync(localSourcePath)) {
                sourceBuffer = await fs.promises.readFile(localSourcePath);
            } else if (isB2Configured()) {
                const b2Obj = await getB2ObjectStream(filename);
                if (b2Obj && b2Obj.stream) {
                    const chunks: Buffer[] = [];
                    for await (const chunk of b2Obj.stream) {
                        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    }
                    sourceBuffer = Buffer.concat(chunks);
                    if (localSourcePath && !fs.existsSync(localSourcePath)) {
                        try { await fs.promises.writeFile(localSourcePath, sourceBuffer); } catch {}
                    }
                }
            }

            if (!sourceBuffer || sourceBuffer.length === 0) {
                return null;
            }

            const sharp = (await import('sharp')).default;
            const thumbBuffer = await sharp(sourceBuffer, { failOn: 'none' })
                .rotate()
                .resize({ width: targetWidth, withoutEnlargement: true })
                .webp({ quality: 80, effort: 2 })
                .toBuffer();

            try {
                await fs.promises.writeFile(cachedThumbPath, thumbBuffer);
            } catch {}

            return thumbBuffer;
        } finally {
            releaseThumbSlot();
            thumbJobsInFlight.delete(jobKey);
        }
    })();

    thumbJobsInFlight.set(jobKey, job);
    return job;
};

app.get('/uploads/:filename', async (req: Request, res: Response, next: NextFunction) => {
    const rawW = req.query.w ? parseInt(String(req.query.w), 10) : null;
    const filename = path.basename(decodeURIComponent(req.params.filename.split('?')[0]));

    if (!rawW || isNaN(rawW) || !/\.(jpe?g|png|webp)$/i.test(filename)) {
        return next();
    }

    const targetWidth = ALLOWED_THUMB_WIDTHS.reduce((prev, curr) =>
        Math.abs(curr - rawW) < Math.abs(prev - rawW) ? curr : prev
    );

    const baseName = path.parse(filename).name;
    const thumbFilename = `${baseName}_w${targetWidth}.webp`;
    const cachedThumbPath = path.join(thumbsDir, thumbFilename);

    if (fs.existsSync(cachedThumbPath)) {
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.sendFile(cachedThumbPath);
    }

    try {
        const thumbBuffer = await generateThumbnailBuffer(filename, targetWidth, cachedThumbPath);
        if (!thumbBuffer) {
            return next();
        }

        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.send(thumbBuffer);
    } catch (err: any) {
        console.warn(`[Thumbnails] Fallback a imagen completa para ${filename}:`, err?.message || err);
        return next();
    }
});

// Servir uploads desde uploadDir persistente (y respaldos si existieran)
app.use('/uploads', express.static(uploadDir));
app.use('/uploads', express.static(path.join(ROOT_DIR, 'public', 'uploads')));
app.use('/uploads', express.static(path.join(DIST_DIR, 'uploads')));

// Si un archivo en /uploads no existe en disco local, servir desde Backblaze B2 con soporte de Range (streaming)
app.use('/uploads', async (req, res) => {
    const requestedFile = path.basename(decodeURIComponent(req.path.split('?')[0]));
    if (!requestedFile || requestedFile === '.' || requestedFile === '..') {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.status(404).send('Asset not found');
    }

    let b2TransientError = false;
    if (isB2Configured()) {
        try {
            const b2Obj = await getB2ObjectStream(requestedFile, req.headers.range);
            if (b2Obj) {
                res.status(b2Obj.statusCode);
                res.setHeader('Content-Type', b2Obj.contentType);
                res.setHeader('Accept-Ranges', b2Obj.acceptRanges);
                if (b2Obj.contentLength !== undefined) {
                    res.setHeader('Content-Length', b2Obj.contentLength);
                }
                if (b2Obj.contentRange) {
                    res.setHeader('Content-Range', b2Obj.contentRange);
                }
                if (b2Obj.etag) {
                    res.setHeader('ETag', b2Obj.etag);
                }
                res.setHeader('Cache-Control', 'public, max-age=86400');

                // Si el navegador cancela o cierra el Range request, abortar inmediatamente el stream S3
                // para no dejar descargas huérfanas saturando el ancho de banda del servidor.
                res.on('close', () => {
                    if (!res.writableEnded) {
                        try { b2Obj.stream.destroy(); } catch {}
                    }
                });

                b2Obj.stream.on('error', (streamErr: any) => {
                    if (streamErr?.name !== 'AbortError' && streamErr?.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
                        console.error(`Error streaming B2 asset ${requestedFile}:`, streamErr);
                    }
                    if (!res.headersSent) res.status(500).end();
                    else { try { res.end(); } catch {} }
                });

                return b2Obj.stream.pipe(res);
            }
        } catch (b2Err: any) {
            b2TransientError = true;
            console.warn(`Aviso al consultar B2 para ${requestedFile}:`, b2Err.message);
        }
    }

    // Si tampoco está en B2 (y NO fue un error temporal de red con B2), intentar auto-repararlo si es portada;
    // y si nada funciona, devolver default-cover.jpg para que ninguna portada salga rota.
    if (/\.(jpg|jpeg|png|webp|gif)$/i.test(requestedFile)) {
        if (!b2TransientError) {
            try {
                const [rows]: any = await pool.execute(
                    'SELECT id, title, artist, album, file_path, cover_path FROM tracks WHERE cover_path = ? OR cover_path LIKE ? LIMIT 1',
                    [`/uploads/${requestedFile}`, `%/${requestedFile}`]
                );
                if (rows?.[0]) {
                    const restoredPath = await healTrackCoverToDisk(rows[0], true);
                    if (restoredPath && fs.existsSync(restoredPath)) {
                        if (isB2Configured()) {
                            syncFileToB2(requestedFile, restoredPath);
                        }
                        return res.sendFile(restoredPath);
                    }
                }
            } catch {}
        }

        const defaultCover = resolveDefaultCoverDiskPath();
        if (defaultCover && fs.existsSync(defaultCover)) {
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
            return res.sendFile(defaultCover);
        }
        if (isB2Configured()) {
            try {
                const b2Obj = await getB2ObjectStream('default_cover.jpg');
                if (b2Obj?.stream) {
                    res.setHeader('Content-Type', b2Obj.contentType || 'image/jpeg');
                    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
                    return b2Obj.stream.pipe(res);
                }
            } catch {}
        }
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.status(404).send('Asset not found');
});

// Descarga directa de una canción al disco duro del usuario con nombre limpio "Artista - Título.ext"
app.get('/api/tracks/:id/download', async (req: Request, res: Response) => {
    try {
        const [rows]: any = await pool.execute(
            'SELECT title, artist, file_path, format FROM tracks WHERE id = ? LIMIT 1',
            [req.params.id]
        );
        if (!rows?.[0]?.file_path) {
            return res.status(404).json({ error: 'Track not found' });
        }

        const track = rows[0];
        const rawFile = path.basename(decodeURIComponent(String(track.file_path).split('?')[0]));
        const ext = (path.extname(rawFile) || (track.format ? `.${track.format}` : '.mp3')).toLowerCase();
        const safeArtist = String(track.artist || 'Aura').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
        const safeTitle = String(track.title || 'Track').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
        const downloadName = `${safeArtist} - ${safeTitle}${ext}`;
        const asciiFallback = downloadName.replace(/[^\x20-\x7E]/g, '_') || `track${ext}`;

        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
        );

        const localPath = resolveDiskPath(track.file_path);
        if (localPath && fs.existsSync(localPath)) {
            return res.sendFile(localPath);
        }

        if (isB2Configured() && rawFile) {
            const b2Obj = await getB2ObjectStream(rawFile);
            if (b2Obj) {
                res.setHeader('Content-Type', b2Obj.contentType || 'application/octet-stream');
                if (b2Obj.contentLength !== undefined) {
                    res.setHeader('Content-Length', b2Obj.contentLength);
                }
                b2Obj.stream.on('error', (err) => {
                    console.error(`Error downloading B2 asset ${rawFile}:`, err);
                    if (!res.headersSent) res.status(500).end();
                });
                return b2Obj.stream.pipe(res);
            }
        }

        return res.status(404).json({ error: 'Audio file not found' });
    } catch (e: any) {
        console.error('Error in /api/tracks/:id/download:', e);
        return res.status(500).json({ error: 'Failed to download track' });
    }
});

// Endpoint administrativo para forzar la sincronización del caché del Top 100
app.post('/api/admin/cache-top-tracks', authenticateToken, async (req: any, res: Response) => {
    if (req.user.role !== 'admin' && req.user.role !== 'moderator') {
        return res.status(403).json({ error: "Forbidden" });
    }
    try {
        const stats = await cacheTop100Tracks(pool, uploadDir);
        res.json({ success: true, stats });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Endpoint administrativo para verificar el estado de Backblaze B2
app.get('/api/admin/b2-status', authenticateToken, async (req: any, res: Response) => {
    if (req.user.role !== 'admin' && req.user.role !== 'moderator') {
        return res.status(403).json({ error: "Forbidden" });
    }
    const missing = getMissingB2EnvVars();
    res.json({
        configured: isB2Configured(),
        missingVars: missing,
        bucket: process.env.B2_BUCKET_NAME || null,
        endpoint: process.env.B2_ENDPOINT || null,
        region: process.env.B2_REGION || 'us-east-005',
        keyIdConfigured: Boolean(process.env.B2_KEY_ID),
        applicationKeyConfigured: Boolean(process.env.B2_APPLICATION_KEY)
    });
});

// Endpoint administrativo para subir a B2 archivos locales que no estén todavía en el bucket
app.post('/api/admin/sync-local-to-b2', authenticateToken, async (req: any, res: Response) => {
    if (req.user.role !== 'admin' && req.user.role !== 'moderator') {
        return res.status(403).json({ error: "Forbidden" });
    }
    if (!isB2Configured()) {
        return res.status(400).json({
            error: "Backblaze B2 no está configurado en .env del servidor.",
            missingVars: getMissingB2EnvVars()
        });
    }
    try {
        if (!fs.existsSync(uploadDir)) {
            return res.json({ success: true, synced: 0, message: "El directorio uploadDir no existe." });
        }
        const localFiles = fs.readdirSync(uploadDir);
        const b2List = await listB2Files();
        const b2FilesSet = new Set(b2List);
        let synced = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const file of localFiles) {
            const fullPath = path.join(uploadDir, file);
            try {
                if (!fs.statSync(fullPath).isFile()) continue;
                if (b2FilesSet.has(file)) {
                    skipped++;
                    continue;
                }
                await uploadToB2(file, fs.createReadStream(fullPath));
                synced++;
            } catch (err: any) {
                errors.push(`${file}: ${err.message}`);
            }
        }
        res.json({
            success: true,
            synced,
            skipped,
            totalLocalFiles: localFiles.length,
            errors: errors.slice(0, 10)
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// AURA DJ - GENERADOR DE PLAYLISTS CON GEMINI
// ==========================================
app.post('/api/ai/dj', async (req: any, res: Response) => {
    const { prompt, apiKey } = req.body;
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: "PROMPT_REQUIRED", message: "Escribe qué tipo de música o ambiente deseas." });
    }

    const geminiKey = (apiKey && typeof apiKey === 'string' && apiKey.trim()) 
        ? apiKey.trim() 
        : process.env.GEMINI_API_KEY;

    if (!geminiKey) {
        return res.status(400).json({ 
            error: "MISSING_API_KEY", 
            message: "Se requiere una API Key de Gemini. Puedes configurarla en el servidor o introducirla en los ajustes de Aura DJ." 
        });
    }

    try {
        const [rows]: any = await pool.execute(
            'SELECT id, title, artist, album, format, coverUrl, audioUrl, tabs_url, track_number, status, createdAt, updatedAt FROM tracks WHERE status = "approved"'
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: "NO_TRACKS", message: "No hay canciones aprobadas en la biblioteca." });
        }

        // Compactar catálogo para minimizar tokens
        const catalogList = rows.map((r: any) => `${r.id}|${r.title}|${r.artist}|${r.album || ''}`).join('\n');

        const systemPrompt = `Eres "Aura DJ", un DJ musical y selector de élite.
Tu misión es seleccionar las mejores canciones de la biblioteca del usuario para satisfacer su petición.
PETICIÓN DEL USUARIO: "${prompt.trim()}"

CATÁLOGO DISPONIBLE (Formato: ID|Título|Artista|Álbum):
${catalogList}

INSTRUCCIONES CRÍTICAS:
1. Elige entre 8 y 25 canciones que mejor encajen con la vibra, estilo, género o energía solicitada.
2. Si la petición es muy concreta y hay pocas canciones exactas, amplía con temas compatibles de artistas similares o misma energía.
3. Ordena las canciones con progresión musical atractiva (un inicio que enganche, desarrollo, subida de energía/clímax, y un buen cierre).
4. Devuelve ÚNICAMENTE un objeto JSON válido con este formato:
{
  "title": "Nombre creativo y atractivo para la mezcla",
  "description": "Una o dos frases explicando por qué estas canciones crean la atmósfera perfecta",
  "vibeTags": ["Rock", "Noche", "Energía"],
  "songIds": [12, 45, 89]
}
No inventes IDs numéricas. Usa estrictamente las IDs del catálogo provisto.`;

        let candidateModels = [
            'gemini-3.5-flash-lite',
            'gemini-3-flash-preview',
            'gemini-3.5-flash',
            'gemini-flash-latest',
            'gemini-2.0-flash',
            'gemini-1.5-flash-latest',
            'gemini-1.5-flash',
            'gemini-1.5-pro'
        ];

        try {
            const listRes = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`, { timeout: 5000 });
            if (Array.isArray(listRes.data?.models)) {
                const supported = listRes.data.models
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
                if (sorted.length > 0) candidateModels = Array.from(new Set(sorted));
            }
        } catch {}
        
        let response: any;
        let lastAxiosError: any = null;

        for (const model of candidateModels) {
            try {
                const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
                response = await axios.post(
                    geminiUrl,
                    {
                        contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
                        generationConfig: {
                            responseMimeType: "application/json",
                            temperature: 0.7
                        }
                    },
                    {
                        headers: { 'Content-Type': 'application/json' },
                        timeout: 20000
                    }
                );
                if (response?.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
                    break;
                }
            } catch (err: any) {
                lastAxiosError = err;
                const msg = err.response?.data?.error?.message || err.message;
                if (err.response?.status === 400 && msg?.includes('API key')) {
                    throw err; // Clave inválida, no seguir probando modelos
                }
                // Si el modelo da 404 o no existe, probar el siguiente
                continue;
            }
        }

        if (!response && lastAxiosError) {
            throw lastAxiosError;
        }

        const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
            return res.status(502).json({ error: "AI_EMPTY_RESPONSE", message: "Gemini no devolvió respuesta para esta consulta." });
        }

        let parsed: any;
        try {
            parsed = JSON.parse(rawText);
        } catch {
            return res.status(502).json({ error: "AI_PARSE_ERROR", message: "Error al procesar la respuesta del DJ." });
        }

        const songIdMap = new Map<string, any>();
        rows.forEach((r: any) => songIdMap.set(String(r.id), r));

        const orderedTracks: any[] = [];
        const seenIds = new Set<string>();

        if (Array.isArray(parsed.songIds)) {
            parsed.songIds.forEach((sid: any) => {
                const key = String(sid);
                if (songIdMap.has(key) && !seenIds.has(key)) {
                    orderedTracks.push(songIdMap.get(key));
                    seenIds.add(key);
                }
            });
        }

        if (orderedTracks.length === 0) {
            return res.status(404).json({ error: "NO_MATCHING_TRACKS", message: "No se encontraron canciones en tu biblioteca que coincidan con esa vibra." });
        }

        res.json({
            title: parsed.title || "Aura DJ Mix",
            description: parsed.description || "Selección personalizada generada por Aura DJ.",
            vibeTags: Array.isArray(parsed.vibeTags) ? parsed.vibeTags : ["Aura DJ", "Mix"],
            tracks: orderedTracks
        });

    } catch (e: any) {
        console.error("Aura DJ error:", e.response?.data || e.message);
        const errMsg = e.response?.data?.error?.message || e.message || "Error al conectar con Gemini";
        const isAuthError = e.response?.status === 400 && errMsg.includes('API key');
        res.status(500).json({ 
            error: isAuthError ? "INVALID_API_KEY" : "AI_ERROR", 
            message: isAuthError ? "La API Key de Gemini no es válida o ha caducado." : errMsg 
        });
    }
});

app.use(express.static(DIST_DIR));
app.get('*', (req, res) => {
    if (req.path.startsWith('/uploads') || /\.(jpg|jpeg|png|webp|gif|mp3|flac|wav|ogg|m4a)$/i.test(req.path)) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.status(404).send('Asset not found');
    }
    res.sendFile(path.join(DIST_DIR, 'index.html'));
});

httpServer.listen(PORT, () => {
    console.log(`🎵 Aura running on ${PORT} (uploads: ${uploadDir})`);
    if (isB2Configured()) {
        console.log(`☁️ Backblaze B2: ACTIVADO (Bucket: ${process.env.B2_BUCKET_NAME}, Endpoint: ${process.env.B2_ENDPOINT})`);
    } else {
        const missing = getMissingB2EnvVars();
        console.warn(`⚠️ Backblaze B2: DESACTIVADO en .env (Variables faltantes: ${missing.join(', ')}). Los archivos subidos se almacenan únicamente en el disco local.`);
    }
    healMissingCoversOnStartup();
    startDailyCacheScheduler(pool, uploadDir);
});




