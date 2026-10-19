import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { isB2Configured, uploadToB2, listB2Files, getBucketName } from './b2Storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.basename(__dirname) === 'dist' ? path.resolve(__dirname, '..') : __dirname;

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const resolveSourceDir = (): string => {
    if (process.env.UPLOAD_DIR && fs.existsSync(process.env.UPLOAD_DIR)) {
        return process.env.UPLOAD_DIR;
    }
    if (process.platform !== 'win32' && fs.existsSync('/var/www/aura-uploads')) {
        return '/var/www/aura-uploads';
    }
    const localUploads = path.join(ROOT_DIR, 'public', 'uploads');
    if (fs.existsSync(localUploads) && fs.statSync(localUploads).isDirectory()) {
        return localUploads;
    }
    const winFallback = path.join(ROOT_DIR, 'uploads_local');
    if (fs.existsSync(winFallback)) {
        return winFallback;
    }
    return localUploads;
};

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

async function main() {
    console.log('🚀 Iniciando script de migración a Backblaze B2...\n');

    if (!isB2Configured()) {
        console.error('❌ Error: Backblaze B2 no está configurado en el archivo .env.');
        console.error('Verifica que B2_BUCKET_NAME, B2_ENDPOINT, B2_KEY_ID y B2_APPLICATION_KEY estén definidos.');
        process.exit(1);
    }

    const sourceDir = resolveSourceDir();
    console.log(`📂 Carpeta de origen detectada: ${sourceDir}`);
    console.log(`🪣 Bucket de destino: ${getBucketName()}`);

    if (!fs.existsSync(sourceDir)) {
        console.error(`❌ La carpeta de origen no existe: ${sourceDir}`);
        process.exit(1);
    }

    const allEntries = fs.readdirSync(sourceDir);
    const filesToMigrate = allEntries.filter(f => {
        try {
            const fullPath = path.join(sourceDir, f);
            const st = fs.statSync(fullPath);
            return st.isFile() && st.size > 0;
        } catch {
            return false;
        }
    });

    console.log(`\n🔍 Archivos encontrados en disco local: ${filesToMigrate.length}`);

    if (filesToMigrate.length === 0) {
        console.log('✨ No hay archivos para migrar.');
        return;
    }

    console.log('📡 Consultando archivos existentes en Backblaze B2...');
    let existingInB2: Set<string>;
    try {
        const remoteKeys = await listB2Files();
        existingInB2 = new Set(remoteKeys);
        console.log(`ℹ️ Archivos ya presentes en B2: ${existingInB2.size}`);
    } catch (err: any) {
        console.warn('⚠️ No se pudo listar el bucket completo (quizá permisos de listado). Se verificará archivo por archivo.');
        existingInB2 = new Set();
    }

    const pending = filesToMigrate.filter(f => !existingInB2.has(f));
    console.log(`📦 Archivos pendientes de subida: ${pending.length}`);

    if (pending.length === 0) {
        console.log('🎉 ¡Todos los archivos locales ya están sincronizados en Backblaze B2!');
        return;
    }

    const CONCURRENCY = 3;
    let completed = 0;
    let failed = 0;
    let totalBytesUploaded = 0;
    const startTime = Date.now();

    const uploadWorker = async (filename: string, maxRetries = 4) => {
        const filePath = path.join(sourceDir, filename);
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const stat = fs.statSync(filePath);
                const stream = fs.createReadStream(filePath);
                await uploadToB2(filename, stream, undefined, stat.size);
                totalBytesUploaded += stat.size;
                completed++;
                const pct = Math.round((completed / pending.length) * 100);
                console.log(`[${completed}/${pending.length}] (${pct}%) ✅ Subido: ${filename} (${formatBytes(stat.size)})`);
                return;
            } catch (e: any) {
                if (attempt < maxRetries) {
                    const delay = attempt * 1500;
                    console.warn(`⚠️ Reintento ${attempt}/${maxRetries} para ${filename} en ${delay}ms (${e.message})...`);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    failed++;
                    console.error(`❌ Falló definitivamente la subida de ${filename} tras ${maxRetries} intentos:`, e.message);
                }
            }
        }
    };

    // Procesador con concurrencia limitada
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
        const batch = pending.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(file => uploadWorker(file)));
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n===========================================');
    console.log('🏁 Migración finalizada.');
    console.log(`⏱️ Tiempo total: ${duration}s`);
    console.log(`✅ Subidos con éxito: ${completed}`);
    console.log(`❌ Errores: ${failed}`);
    console.log(`📊 Datos totales transferidos: ${formatBytes(totalBytesUploaded)}`);
    console.log('===========================================\n');
}

main().catch(err => {
    console.error('Error fatal durante la migración:', err);
    process.exit(1);
});
