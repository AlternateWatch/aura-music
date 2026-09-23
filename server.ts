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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

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
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir, { recursive: true }); }
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

const deleteTrackFiles = async (trackId: string) => {
    try {
        const [rows]: any = await pool.execute('SELECT file_path, cover_path, animated_cover_path FROM tracks WHERE id = ?', [trackId]);
        if (rows[0]) {
            const track = rows[0];
            const audioPath = path.join(__dirname, 'public', track.file_path.startsWith('/') ? track.file_path.substring(1) : track.file_path);
            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
            if (track.cover_path) {
                const coverPath = path.join(__dirname, 'public', track.cover_path.startsWith('/') ? track.cover_path.substring(1) : track.cover_path);
                if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
            }
            if (track.animated_cover_path) {
                const animPath = path.join(__dirname, 'public', track.animated_cover_path.startsWith('/') ? track.animated_cover_path.substring(1) : track.animated_cover_path);
                if (fs.existsSync(animPath)) fs.unlinkSync(animPath);
            }
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
    // 1. Recogemos video_url del body:
    const { title, artist, album, tabs_url, track_number, video_url } = req.body;
    if (!req.files['audio']) return res.status(400).send("No audio");
    const format = path.extname(req.files['audio'][0].originalname).includes('flac') ? 'flac' : 'mp3';
    
    const initialStatus = (req.user.role === 'admin' || req.user.role === 'moderator') ? 'approved' : 'pending';

    // 2. Guardamos video_url en la base de datos:
    const [result]: any = await pool.execute(
        'INSERT INTO tracks (title, artist, album, file_path, cover_path, added_by, status, format, tabs_url, video_url, track_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
        [title, artist, album, `/uploads/${req.files['audio'][0].filename}`, req.files['cover'] ? `/uploads/${req.files['cover'][0].filename}` : null, req.user.userId, initialStatus, format, tabs_url || null, video_url || null, track_number || null]
    );
    res.status(201).json({ id: result.insertId });
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
    let coverPath = req.body.cover_path;
    let animatedCoverPath = req.body.animated_cover_path;

    try {
        if (req.files && req.files['cover']) {
            const coverFile = req.files['cover'][0];
            const [rows]: any = await pool.execute('SELECT cover_path FROM tracks WHERE id = ?', [req.params.id]);
            if (rows[0]?.cover_path) {
                const oldPath = path.join(__dirname, 'public', rows[0].cover_path.startsWith('/') ? rows[0].cover_path.substring(1) : rows[0].cover_path);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            coverPath = `/uploads/${coverFile.filename}`;
        }

        if (req.files && req.files['animated_cover']) {
            const animFile = req.files['animated_cover'][0];
            const [rows]: any = await pool.execute('SELECT animated_cover_path FROM tracks WHERE id = ?', [req.params.id]);
            if (rows[0]?.animated_cover_path) {
                const oldAnimPath = path.join(__dirname, 'public', rows[0].animated_cover_path.startsWith('/') ? rows[0].animated_cover_path.substring(1) : rows[0].animated_cover_path);
                if (fs.existsSync(oldAnimPath)) fs.unlinkSync(oldAnimPath);
            }
            animatedCoverPath = `/uploads/${animFile.filename}`;
        }

        const cleanT = (track_number === "" || track_number === "null" || track_number === "0") ? null : parseInt(track_number);
        await pool.execute(
            'UPDATE tracks SET title = ?, artist = ?, album = ?, track_number = ?, tabs_url = ?, video_url = ?, cover_path = ?, animated_cover_path = ? WHERE id = ?', 
            [title, artist, album, cleanT, tabs_url || null, video_url || null, coverPath, animatedCoverPath || null, req.params.id]
        ); 
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
        // Borramos la imagen vieja del disco si ya tenía una
        const [rows]: any = await pool.execute('SELECT image_url FROM artists WHERE name = ?', [req.params.name]);
        if (rows.length > 0 && rows[0].image_url) {
            const oldPath = path.join(__dirname, 'public', rows[0].image_url.startsWith('/') ? rows[0].image_url.substring(1) : rows[0].image_url);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        // Guardamos o actualizamos la foto en la base de datos
        await pool.execute(
            'INSERT INTO artists (name, image_url) VALUES (?, ?) ON DUPLICATE KEY UPDATE image_url = VALUES(image_url)',
            [req.params.name, newImagePath]
        );

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

        // Get current profile pic so we can delete the old file from the hard drive
        const [userRows]: any = await pool.execute('SELECT profile_pic_path FROM users WHERE id = ?', [req.user.userId]);
        if (userRows[0]?.profile_pic_path) {
            const oldPath = path.join(__dirname, 'public', userRows[0].profile_pic_path.startsWith('/') ? userRows[0].profile_pic_path.substring(1) : userRows[0].profile_pic_path);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); // Free up storage space
        }

        // Update the database with the new image path
        await pool.execute('UPDATE users SET profile_pic_path = ? WHERE id = ?', [newPicPath, req.user.userId]);
        
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

        // Eliminar el wallpaper anterior del disco
        if (userRows[0]?.custom_bg_path) {
            const oldPath = path.join(
                __dirname,
                'public',
                userRows[0].custom_bg_path.startsWith('/')
                    ? userRows[0].custom_bg_path.substring(1)
                    : userRows[0].custom_bg_path
            );

            if (fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
            }
        }

        // Guardar el nuevo wallpaper en la base de datos
        await pool.execute(
            'UPDATE users SET custom_bg_path = ? WHERE id = ?',
            [newBgPath, req.user.userId]
        );

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
            connection.release();
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
app.post('/api/sessions/create', authenticateToken, async (req: any, res: Response) => { const c = Math.random().toString(36).substring(2, 8).toUpperCase(); await pool.execute('INSERT INTO sessions (code, host_id) VALUES (?, ?)', [c, req.user.userId]); res.json({ code: c }); });

io.on('connection', (socket) => {
    socket.on('identify', (uid) => { socket.join(`user_${uid}`); });
    socket.on('join-session', async ({ code, user }) => { socket.join(code); io.to(code).emit('user-joined', user); });
    socket.on('send-command', ({ code, command, data }) => { socket.to(code).emit('receive-command', { command, data }); });
    socket.on('send-chat', ({ code, user, message }) => { io.to(code).emit('receive-chat', { user, message, time: new Date() }); });
    socket.on('send-private-message', ({ sender, receiverId, message }) => { io.to(`user_${receiverId}`).emit('receive-private-message', { sender_id: sender.userId, receiver_id: receiverId, message, created_at: new Date() }); });
    socket.on('send-session-invite', ({ senderName, receiverId, code }) => { io.to(`user_${receiverId}`).emit('receive-session-invite', { from: senderName, code }); });
});

app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'dist', 'index.html')); });

httpServer.listen(PORT, () => { console.log(`🎵 Aura running on ${PORT}`); });