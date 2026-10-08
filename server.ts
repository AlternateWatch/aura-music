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

// --- PATH UTILS ---
const resolveAssetPath = (filePath: string | null) => {
    if (!filePath) return null;
    const trimmedPath = filePath.trim();
    if (trimmedPath.startsWith('http')) return trimmedPath;
    const baseUrl = process.env.BASE_URL || '';
    if (!baseUrl) return trimmedPath;

    const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const normalizedPath = trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`;
    return `${normalizedBase}${normalizedPath}`;
};

const normalizeAssetPath = (filePath: string | null) => {
    if (!filePath) return null;
    // Extract filename from absolute path (Windows or Unix)
    const filename = path.basename(filePath);
    return `/uploads/${filename}`;
};

// --- STORAGE ---
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

// --- SOCIAL INFRASTRUCTURE ---
pool.execute(`
    CREATE TABLE IF NOT EXISTS user_friends (
        user_id INT UNSIGNED NOT NULL,
        friend_id INT UNSIGNED NOT NULL,
        status ENUM('pending', 'accepted', 'blocked') DEFAULT 'pending',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, friend_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
    )
`).catch(err => console.error('Error creating user_friends table:', err));

// In-memory map of who is listening to what: userId -> { trackId, title, artist, updatedAt }
const liveActivity = new Map<string, { trackId: string | null, title: string | null, artist: string | null, updatedAt: number }>();

// --- ESTADÍSTICAS DE ESCUCHA (para el "Wrapped") ---
// Una fila por cada 30s de escucha real. title/artist/album se guardan en el
// momento, así el resumen sigue funcionando aunque la canción se borre luego.
pool.execute(`
    CREATE TABLE IF NOT EXISTS listen_pings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        track_id VARCHAR(64) NULL,
        title VARCHAR(255) NOT NULL,
        artist VARCHAR(255) NOT NULL,
        album VARCHAR(255) NULL,
        ms INT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_time (user_id, created_at)
    )
`).catch(err => console.error('No se pudo crear la tabla listen_pings:', err));

// --- MENSAJES PRIVADOS ENTRE AMIGOS ---
pool.execute(`
    CREATE TABLE IF NOT EXISTS private_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sender_id INT NOT NULL,
        receiver_id INT NOT NULL,
        message VARCHAR(1000) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_conversation (sender_id, receiver_id, created_at)
    )
`).catch(err => console.error('No se pudo crear la tabla private_messages:', err));

const authenticateToken = (req: any, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        console.log("❌ Error: No token recibido");
        return res.status(401).json({ error: "No token." });
    }

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
        if (err) {
            console.log("❌ Error de Verificación JWT:", err.message);
            console.log("🔑 Secret usada para validar:", JWT_SECRET.substring(0, 5) + "...");
            return res.status(403).json({ error: "Invalid session.", details: err.message });
        }
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
// --- SOCIAL API ---
app.post('/api/social/friend-request', authenticateToken, async (req: any, res: Response) => {
    const { friendId } = req.body;
    if (!friendId) return res.status(400).json({ error: "friendId is required" });
    try {
        await pool.execute(
            'INSERT INTO user_friends (user_id, friend_id, status) VALUES (?, ?, "pending") ON DUPLICATE KEY UPDATE status = status',
            [req.user.userId, friendId]
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Database error" }); }
});

// Busca usuarios por nombre (para añadir amigos nuevos, no solo filtrar los que ya tienes).
app.get('/api/social/search', authenticateToken, async (req: any, res: Response) => {
    try {
        const q = String(req.query.q || '').trim();
        if (q.length < 2) return res.json([]); // evita consultas enormes con 1 sola letra

        const [rows]: any = await pool.execute(
            `SELECT u.id, u.username, u.profile_pic_path,
                    (SELECT status FROM user_friends WHERE user_id = ? AND friend_id = u.id) AS outgoingStatus,
                    (SELECT status FROM user_friends WHERE user_id = u.id AND friend_id = ?) AS incomingStatus
             FROM users u
             WHERE u.username LIKE ? AND u.id != ?
             ORDER BY u.username ASC
             LIMIT 20`,
            [req.user.userId, req.user.userId, `%${q}%`, req.user.userId]
        );
        res.json(rows);
    } catch (e: any) {
        console.error("SOCIAL_SEARCH_ERROR:", e);
        res.status(500).json({ error: "Database error", details: e.message });
    }
});

// Solicitudes de amistad que me han mandado a mí y sigo sin responder.
app.get('/api/social/requests', authenticateToken, async (req: any, res: Response) => {
    try {
        const [rows]: any = await pool.execute(
            `SELECT u.id, u.username, u.profile_pic_path
             FROM users u
             JOIN user_friends f ON u.id = f.user_id
             WHERE f.friend_id = ? AND f.status = 'pending'`,
            [req.user.userId]
        );
        res.json(rows);
    } catch (e: any) {
        console.error("SOCIAL_REQUESTS_ERROR:", e);
        res.status(500).json({ error: "Database error", details: e.message });
    }
});

// Aceptar o rechazar una solicitud recibida. Al aceptar, se crea también la fila
// en sentido contrario para que la amistad aparezca en la lista de ambos.
app.post('/api/social/friend-request/respond', authenticateToken, async (req: any, res: Response) => {
    const { friendId, accept } = req.body;
    if (!friendId) return res.status(400).json({ error: "friendId is required" });
    try {
        if (accept) {
            await pool.execute(
                'UPDATE user_friends SET status = "accepted" WHERE user_id = ? AND friend_id = ? AND status = "pending"',
                [friendId, req.user.userId]
            );
            await pool.execute(
                'INSERT INTO user_friends (user_id, friend_id, status) VALUES (?, ?, "accepted") ON DUPLICATE KEY UPDATE status = "accepted"',
                [req.user.userId, friendId]
            );
        } else {
            await pool.execute(
                'DELETE FROM user_friends WHERE user_id = ? AND friend_id = ? AND status = "pending"',
                [friendId, req.user.userId]
            );
        }
        res.json({ success: true });
    } catch (e: any) {
        console.error("SOCIAL_RESPOND_ERROR:", e);
        res.status(500).json({ error: "Database error", details: e.message });
    }
});

// Historial de mensajes con un amigo concreto (los últimos 100).
app.get('/api/social/chat/:friendId', authenticateToken, async (req: any, res: Response) => {
    try {
        const friendId = req.params.friendId;
        const [rows]: any = await pool.execute(
            `SELECT id, sender_id, receiver_id, message, created_at FROM private_messages
             WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
             ORDER BY created_at ASC LIMIT 100`,
            [req.user.userId, friendId, friendId, req.user.userId]
        );
        res.json(rows);
    } catch (e: any) {
        console.error("SOCIAL_CHAT_HISTORY_ERROR:", e);
        res.status(500).json({ error: "Database error", details: e.message });
    }
});

// Enviar un mensaje privado (se guarda y además se manda en vivo por socket
// desde el propio cliente con 'send-private-message', que ya existía).
app.post('/api/social/chat', authenticateToken, async (req: any, res: Response) => {
    try {
        const { receiverId, message } = req.body;
        const clean = String(message || '').trim().slice(0, 1000);
        if (!receiverId || !clean) return res.status(400).json({ error: "Faltan datos del mensaje" });
        const [result]: any = await pool.execute(
            'INSERT INTO private_messages (sender_id, receiver_id, message) VALUES (?, ?, ?)',
            [req.user.userId, receiverId, clean]
        );
        res.json({ id: result.insertId, sender_id: req.user.userId, receiver_id: receiverId, message: clean, created_at: new Date() });
    } catch (e: any) {
        console.error("SOCIAL_CHAT_SEND_ERROR:", e);
        res.status(500).json({ error: "Database error", details: e.message });
    }
});

app.get('/api/social/friends', authenticateToken, async (req: any, res: Response) => {
    try {
        console.log(`Fetching friends for user: ${req.user.userId}`);
        const [rows]: any = await pool.execute(
            `SELECT u.id, u.username, u.profile_pic_path, f.status
             FROM users u
             JOIN user_friends f ON u.id = f.friend_id
             WHERE f.user_id = ?`,
            [req.user.userId]
        );
        console.log(`Found ${rows.length} friends`);
        res.json(rows);
    } catch (e: any) {
        console.error("SOCIAL_FRIENDS_ERROR:", e);
        res.status(500).json({ error: "Database error", details: e.message });
    }
});

app.get('/api/social/activity', authenticateToken, async (req: any, res: Response) => {
    try {
        console.log(`Fetching activity for user: ${req.user.userId}`);
        const [friends]: any = await pool.execute(
            'SELECT friend_id FROM user_friends WHERE user_id = ? AND status = "accepted"',
            [req.user.userId]
        );
        const friendIds: string[] = friends.map((f: any) => String(f.friend_id));
        const activeIds = friendIds.filter((id: string) => liveActivity.has(id));

        let usersById: Record<string, { username: string; profile_pic_path: string | null }> = {};
        if (activeIds.length > 0) {
            const placeholders = activeIds.map(() => '?').join(',');
            const [userRows]: any = await pool.execute(
                `SELECT id, username, profile_pic_path FROM users WHERE id IN (${placeholders})`,
                activeIds
            );
            usersById = Object.fromEntries(userRows.map((u: any) => [String(u.id), u]));
        }

        const activity: any[] = [];
        liveActivity.forEach((data, userId) => {
            if (friendIds.includes(userId)) {
                const u = usersById[userId];
                activity.push({ userId, username: u?.username ?? 'Usuario', profile_pic_path: u?.profile_pic_path ?? null, ...data });
            }
        });
        res.json(activity);
    } catch (e: any) {
        console.error("SOCIAL_ACTIVITY_ERROR:", e);
        res.status(500).json({ error: "Database error", details: e.message });
    }
});

const cleanupLocalPaths = async () => {
    console.log("Starting cleanup of local paths...");
    try {
        const tables = [
            { table: 'tracks', cols: ['file_path', 'cover_path', 'animated_cover_path'] },
            { table: 'users', cols: ['profile_pic_path', 'custom_bg_path'] },
            { table: 'artists', cols: ['image_url'] }
        ];

        let totalFixed = 0;

        for (const { table, cols } of tables) {
            for (const col of cols) {
                const [rows]: any = await pool.execute(`SELECT id, ${col} FROM ${table} WHERE ${col} IS NOT NULL`);
                for (const row of rows) {
                    const currentPath = row[col];
                    if (currentPath && (currentPath.includes(':\\') || currentPath.includes('/Users/') || currentPath.includes('/home/'))) {
                        const fixedPath = normalizeAssetPath(currentPath);
                        await pool.execute(`UPDATE ${table} SET ${col} = ? WHERE id = ?`, [fixedPath, row.id]);
                        totalFixed++;
                    }
                }
            }
        }
        console.log(`Cleanup finished. Fixed ${totalFixed} paths.`);
        return { success: true, totalFixed };
    } catch (e) {
        console.error("Cleanup error:", e);
        throw e;
    }
};

app.post('/api/admin/cleanup-paths', authenticateToken, async (req: any, res: Response) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Forbidden: Admins only." });
    try {
        const result = await cleanupLocalPaths();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: "Internal server error during cleanup." });
    }
});
const purgeAlbumCovers = async () => {
    let albumsProcessed = 0;
    let filesDeleted = 0;
    let tracksUpdated = 0;
    const potentialDeletions = new Set<string>();

    try {
        // 1. Identify albums with more than one track
        const [albums]: any = await pool.execute(
            "SELECT album FROM tracks WHERE album IS NOT NULL AND album != '' GROUP BY album HAVING COUNT(*) > 1"
        );

        for (const albumRow of albums) {
            const albumName = albumRow.album;

            // 2. Fetch all tracks in the album ordered by ID
            const [tracks]: any = await pool.execute(
                "SELECT id, cover_path, animated_cover_path FROM tracks WHERE album = ? ORDER BY id ASC",
                [albumName]
            );

            if (tracks.length <= 1) continue;

            const masterCover = tracks[0].cover_path;
            const masterAnimCover = tracks[0].animated_cover_path;

            // 3. Update other tracks and collect redundant files
            for (let i = 1; i < tracks.length; i++) {
                const track = tracks[i];
                let updated = false;

                if (track.cover_path !== masterCover) {
                    if (track.cover_path) potentialDeletions.add(track.cover_path);
                    updated = true;
                }
                if (track.animated_cover_path !== masterAnimCover) {
                    if (track.animated_cover_path) potentialDeletions.add(track.animated_cover_path);
                    updated = true;
                }

                if (updated) {
                    await pool.execute(
                        "UPDATE tracks SET cover_path = ?, animated_cover_path = ? WHERE id = ?",
                        [masterCover, masterAnimCover, track.id]
                    );
                    tracksUpdated++;
                }
            }
            albumsProcessed++;
        }

        // 4. Safe Deletion: Only delete if no other tracks in the whole DB use these files
        for (const p of potentialDeletions) {
            const [check]: any = await pool.execute(
                "SELECT COUNT(*) as count FROM tracks WHERE cover_path = ? OR animated_cover_path = ?",
                [p, p]
            );

            if (check[0].count === 0) {
                const fullPath = p.startsWith('/') ? p.substring(1) : p;
                const absPath = path.join(__dirname, 'public', fullPath);
                if (fs.existsSync(absPath)) {
                    fs.unlinkSync(absPath);
                    filesDeleted++;
                }
            }
        }

        return { albumsProcessed, filesDeleted, tracksUpdated };
    } catch (error) {
        console.error("Purge covers error:", error);
        throw error;
    }
};

app.post('/api/admin/purge-album-covers', authenticateToken, async (req: any, res: Response) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Forbidden: Admins only." });
    try {
        const result = await purgeAlbumCovers();
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ error: "Internal server error during purge." });
    }
});

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
        const [t]: any = await pool.execute(query, [userId, s]);
        const processedTracks = t.map((track: any) => ({
            ...track,
            file_path: resolveAssetPath(track.file_path),
            cover_path: resolveAssetPath(track.cover_path),
            animated_cover_path: resolveAssetPath(track.animated_cover_path)
        }));
        res.json(processedTracks);
    } catch (e) { res.status(500).send(); }
});

app.post('/api/tracks', authenticateToken, upload.fields([{ name: 'audio' }, { name: 'cover' }]), async (req: any, res: Response) => {
    const { title, artist, album, tabs_url, track_number, video_url } = req.body;
    if (!req.files['audio']) return res.status(400).send("No audio");
    const format = path.extname(req.files['audio'][0].originalname).includes('flac') ? 'flac' : 'mp3';
    const initialStatus = (req.user.role === 'admin' || req.user.role === 'moderator') ? 'approved' : 'pending';

    let coverUrl = null;
    if (req.files['cover']) {
        coverUrl = normalizeAssetPath(req.files['cover'][0].filename);
    }

    const [result]: any = await pool.execute(
        'INSERT INTO tracks (title, artist, album, file_path, cover_path, added_by, status, format, tabs_url, video_url, track_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [title, artist, album, normalizeAssetPath(req.files['audio'][0].filename), coverUrl, req.user.userId, initialStatus, format, tabs_url || null, video_url || null, track_number || null]
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
            coverPath = normalizeAssetPath(coverFile.filename);
        } else if (coverPath === "" || coverPath === null) {
            const [rows]: any = await pool.execute('SELECT cover_path FROM tracks WHERE id = ?', [req.params.id]);
            if (rows[0]?.cover_path) {
                const oldPath = path.join(__dirname, 'public', rows[0].cover_path.startsWith('/') ? rows[0].cover_path.substring(1) : rows[0].cover_path);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
        }

        if (req.files && req.files['animated_cover']) {
            const animFile = req.files['animated_cover'][0];
            const [rows]: any = await pool.execute('SELECT animated_cover_path FROM tracks WHERE id = ?', [req.params.id]);
            if (rows[0]?.animated_cover_path) {
                const oldAnimPath = path.join(__dirname, 'public', rows[0].animated_cover_path.startsWith('/') ? rows[0].animated_cover_path.substring(1) : rows[0].animated_cover_path);
                if (fs.existsSync(oldAnimPath)) fs.unlinkSync(oldAnimPath);
            }
            animatedCoverPath = normalizeAssetPath(animFile.filename);
        } else if (animatedCoverPath === "" || animatedCoverPath === null) {
            const [rows]: any = await pool.execute('SELECT animated_cover_path FROM tracks WHERE id = ?', [req.params.id]);
            if (rows[0]?.animated_cover_path) {
                const oldAnimPath = path.join(__dirname, 'public', rows[0].animated_cover_path.startsWith('/') ? rows[0].animated_cover_path.substring(1) : rows[0].animated_cover_path);
                if (fs.existsSync(oldAnimPath)) fs.unlinkSync(oldAnimPath);
            }
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
            const artist = rows[0];
            artist.image_url = resolveAssetPath(artist.image_url);
            res.json(artist);
        } else {
            res.json({ name: req.params.name, bio: null });
        }
    } catch (error) {
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
        const [userRows]: any = await pool.execute(
            'SELECT id, username, email, role, profile_pic_path, custom_bg_path FROM users WHERE id = ?',
            [req.user.userId]
        );

        if (userRows.length === 0) return res.status(404).json({ error: "User not found" });

        const user = userRows[0];
        user.profile_pic_path = resolveAssetPath(user.profile_pic_path);
        user.custom_bg_path = resolveAssetPath(user.custom_bg_path);

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
            ...user,
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
// Aviso periódico de que se sigue escuchando algo (cada ~30s desde el cliente).
app.post('/api/stats/ping', authenticateToken, async (req: any, res: Response) => {
    try {
        const { trackId, title, artist, album, ms } = req.body || {};
        const cleanMs = Math.max(1000, Math.min(Number(ms) || 0, 60000)); // entre 1s y 60s, por si acaso
        if (!title || !artist) return res.status(400).json({ error: 'Faltan datos de la canción' });
        await pool.execute(
            'INSERT INTO listen_pings (user_id, track_id, title, artist, album, ms) VALUES (?, ?, ?, ?, ?, ?)',
            [req.user.userId, trackId || null, String(title).slice(0, 255), String(artist).slice(0, 255), album ? String(album).slice(0, 255) : null, cleanMs]
        );
        res.sendStatus(204);
    } catch (err) {
        console.error('stats/ping error:', err);
        res.sendStatus(204); // nunca debe romper la reproducción por esto
    }
});

// Resumen tipo "Wrapped": lo más escuchado en el periodo pedido.
app.get('/api/stats/wrapped', authenticateToken, async (req: any, res: Response) => {
    try {
        const range = String(req.query.range || 'month');
        const where =
            range === 'year' ? 'YEAR(created_at) = YEAR(NOW())' :
            range === 'all' ? '1=1' :
            'created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)'; // 'month' por defecto

        const [totalsRows]: any = await pool.execute(
            `SELECT COALESCE(SUM(ms),0) AS totalMs, COUNT(DISTINCT track_id) AS distinctTracks, COUNT(*) AS pings
             FROM listen_pings WHERE user_id = ? AND ${where}`,
            [req.user.userId]
        );
        const [topTracks]: any = await pool.execute(
            `SELECT track_id AS trackId, title, artist, album, SUM(ms) AS totalMs, COUNT(*) AS plays
             FROM listen_pings WHERE user_id = ? AND ${where}
             GROUP BY track_id, title, artist, album ORDER BY totalMs DESC LIMIT 5`,
            [req.user.userId]
        );
        const [topArtists]: any = await pool.execute(
            `SELECT artist, SUM(ms) AS totalMs, COUNT(*) AS plays
             FROM listen_pings WHERE user_id = ? AND ${where}
             GROUP BY artist ORDER BY totalMs DESC LIMIT 5`,
            [req.user.userId]
        );

        res.json({
            range,
            totalMinutes: Math.round((totalsRows[0]?.totalMs || 0) / 60000),
            distinctTracks: totalsRows[0]?.distinctTracks || 0,
            topTracks,
            topArtists
        });
    } catch (err) {
        console.error('stats/wrapped error:', err);
        res.status(500).json({ error: 'No se pudo calcular el resumen' });
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
        case 'update-queue':
            // Solo la cola: cualquier miembro puede añadir/reordenar canciones
            // sin tocar lo que suena ahora mismo (eso sigue siendo del anfitrión).
            if (Array.isArray(data?.queue)) st.queue = data.queue;
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
        if (!userStillInRoom(code, u.userId)) {
            systemChat(code, `${u.username} ha salido de la sesión 👋`, 'leave');
        }
    };
    if (!delayed) return doIt();
    broadcastMembers(code);
    if (pendingLeaves.has(key)) clearTimeout(pendingLeaves.get(key)!);
    pendingLeaves.set(key, setTimeout(doIt, LEAVE_ANNOUNCE_DELAY_MS));
};

io.on('connection', (socket) => {
    socket.on('identify', (uid) => {
        socket.join(`user_${uid}`);
        socket.data.userId = uid; // Store the userId directly on the socket
    });

    // Update current listening status
    socket.on('update-activity', ({ trackId, title, artist }) => {
        const uid = socket.data.userId;
        if (!uid) return;
        liveActivity.set(String(uid), {
            trackId: String(trackId || ''),
            title: String(title || ''),
            artist: String(artist || ''),
            updatedAt: Date.now()
        });
    });

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

const distPath = __dirname.endsWith('dist') ? __dirname : path.join(__dirname, 'dist');

app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use(express.static(distPath));
app.get('*', (req, res) => { res.sendFile(path.join(distPath, 'index.html')); });

httpServer.listen(PORT, () => { console.log(`🎵 Aura running on ${PORT}`); });