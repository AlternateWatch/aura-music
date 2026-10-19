import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import path from 'path';

// Determina el tipo MIME según la extensión para asegurar reproducción correcta
export const getMimeType = (filename: string): string => {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
        case '.mp3': return 'audio/mpeg';
        case '.flac': return 'audio/flac';
        case '.m4a': return 'audio/mp4';
        case '.wav': return 'audio/wav';
        case '.ogg': return 'audio/ogg';
        case '.aac': return 'audio/aac';
        case '.jpg':
        case '.jpeg': return 'image/jpeg';
        case '.png': return 'image/png';
        case '.webp': return 'image/webp';
        case '.gif': return 'image/gif';
        case '.mp4': return 'video/mp4';
        default: return 'application/octet-stream';
    }
};

let cachedClient: S3Client | null = null;

export const isB2Configured = (): boolean => {
    return Boolean(
        process.env.B2_BUCKET_NAME &&
        process.env.B2_ENDPOINT &&
        process.env.B2_KEY_ID &&
        process.env.B2_APPLICATION_KEY
    );
};

export const getB2Client = (): S3Client => {
    if (cachedClient) return cachedClient;

    let endpoint = process.env.B2_ENDPOINT || '';
    if (endpoint && !endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
        endpoint = `https://${endpoint}`;
    }

    cachedClient = new S3Client({
        endpoint,
        region: process.env.B2_REGION || 'us-east-005',
        credentials: {
            accessKeyId: process.env.B2_KEY_ID || '',
            secretAccessKey: process.env.B2_APPLICATION_KEY || '',
        },
    });

    return cachedClient;
};

export const getBucketName = (): string => {
    return process.env.B2_BUCKET_NAME || '';
};

/**
 * Sube un archivo a Backblaze B2
 */
export const uploadToB2 = async (
    key: string,
    body: Buffer | Uint8Array | Readable,
    contentType?: string,
    contentLength?: number
): Promise<boolean> => {
    if (!isB2Configured()) {
        console.warn('⚠️ Backblaze B2 no está configurado en las variables de entorno.');
        return false;
    }

    const client = getB2Client();
    const mime = contentType || getMimeType(key);

    const command = new PutObjectCommand({
        Bucket: getBucketName(),
        Key: key,
        Body: body,
        ContentType: mime,
        ...(contentLength ? { ContentLength: contentLength } : {})
    });

    await client.send(command);
    return true;
};

/**
 * Obtiene el stream de un archivo desde Backblaze B2 con soporte completo de cabecera Range
 */
export const getB2ObjectStream = async (
    key: string,
    range?: string
) => {
    if (!isB2Configured()) return null;

    const client = getB2Client();
    const command = new GetObjectCommand({
        Bucket: getBucketName(),
        Key: key,
        ...(range ? { Range: range } : {})
    });

    try {
        const response = await client.send(command);
        return {
            stream: response.Body as Readable,
            contentType: response.ContentType || getMimeType(key),
            contentLength: response.ContentLength,
            contentRange: response.ContentRange,
            acceptRanges: response.AcceptRanges || 'bytes',
            statusCode: response.ContentRange ? 206 : 200,
            etag: response.ETag,
            lastModified: response.LastModified
        };
    } catch (err: any) {
        if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
            return null;
        }
        throw err;
    }
};

/**
 * Comprueba si un archivo existe en B2
 */
export const checkB2FileExists = async (key: string): Promise<boolean> => {
    if (!isB2Configured()) return false;
    const client = getB2Client();
    try {
        await client.send(new HeadObjectCommand({
            Bucket: getBucketName(),
            Key: key
        }));
        return true;
    } catch (err: any) {
        if (err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
            return false;
        }
        // En caso de otro error, registrar y asumir falso
        console.warn(`Error al verificar objeto B2 ${key}:`, err.message);
        return false;
    }
};

/**
 * Elimina un archivo de Backblaze B2
 */
export const deleteFromB2 = async (key: string): Promise<boolean> => {
    if (!isB2Configured()) return false;
    const client = getB2Client();
    try {
        await client.send(new DeleteObjectCommand({
            Bucket: getBucketName(),
            Key: key
        }));
        return true;
    } catch (err: any) {
        console.warn(`Error al eliminar objeto B2 ${key}:`, err.message);
        return false;
    }
};

/**
 * Lista todos los archivos (o hasta 1000) de Backblaze B2
 */
export const listB2Files = async (prefix?: string): Promise<string[]> => {
    if (!isB2Configured()) return [];
    const client = getB2Client();
    const keys: string[] = [];
    let continuationToken: string | undefined = undefined;

    do {
        const command = new ListObjectsV2Command({
            Bucket: getBucketName(),
            Prefix: prefix,
            ContinuationToken: continuationToken
        });
        const response = await client.send(command);
        if (response.Contents) {
            for (const item of response.Contents) {
                if (item.Key) keys.push(item.Key);
            }
        }
        continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return keys;
};
