import { type Song } from '../constants';
import { resolveFileUrl } from '../hooks/useFileUrl';
import { DEFAULT_COVER } from './api';

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

async function loadSongCoverImage(song: Song): Promise<HTMLImageElement> {
  const candidates: string[] = [];
  try {
    const resolved = await resolveFileUrl(song.coverUrl);
    if (resolved) candidates.push(resolved);
  } catch {}
  if (song.coverUrl && !candidates.includes(song.coverUrl)) {
    candidates.push(song.coverUrl);
  }
  candidates.push(DEFAULT_COVER);

  for (const url of candidates) {
    try {
      return await loadImageElement(url);
    } catch {}
  }
  throw new Error('Could not load any cover image');
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(truncated + '…').width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '…';
}

function extractDominantColors(img: HTMLImageElement): { topHex: string; bottomHex: string; rgb: [number, number, number] } {
  try {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    const ctx = c.getContext('2d');
    if (!ctx) return { topHex: '#18181b', bottomHex: '#09090b', rgb: [242, 125, 38] };
    ctx.drawImage(img, 0, 0, 4, 4);
    const data = ctx.getImageData(0, 0, 4, 4).data;
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
    r = Math.round(r / count);
    g = Math.round(g / count);
    b = Math.round(b / count);
    const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    const topHex = `#${toHex(r * 0.45)}${toHex(g * 0.45)}${toHex(b * 0.45)}`;
    const bottomHex = `#${toHex(r * 0.15)}${toHex(g * 0.15)}${toHex(b * 0.15)}`;
    return { topHex, bottomHex, rgb: [r, g, b] };
  } catch {
    return { topHex: '#18181b', bottomHex: '#09090b', rgb: [242, 125, 38] };
  }
}

function drawTidalCardOnCanvas(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  song: Song,
  cardX: number,
  cardY: number,
  cardW: number,
  cardH: number,
  accentRgb: [number, number, number]
) {
  const pad = 44;

  // Sombra profunda de la tarjeta
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.72)';
  ctx.shadowBlur = 65;
  ctx.shadowOffsetY = 28;
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 48);
  ctx.fillStyle = 'rgba(14, 14, 18, 0.90)';
  ctx.fill();
  ctx.restore();

  // Resplandor sutil superior dentro de la tarjeta
  ctx.save();
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 48);
  ctx.clip();
  const cardGlow = ctx.createRadialGradient(
    cardX + cardW / 2,
    cardY + 120,
    40,
    cardX + cardW / 2,
    cardY + 260,
    cardW * 0.85
  );
  cardGlow.addColorStop(0, `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, 0.22)`);
  cardGlow.addColorStop(1, 'rgba(14, 14, 18, 0)');
  ctx.fillStyle = cardGlow;
  ctx.fillRect(cardX, cardY, cardW, cardH);
  ctx.restore();

  // Borde fino cristalino
  ctx.save();
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 48);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Cabecera dentro de la tarjeta: Logo AURA. + Badge de formato
  const headerY = cardY + pad + 32;
  ctx.save();
  ctx.font = '900 34px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText('AURA', cardX + pad, headerY);
  const auraWidth = ctx.measureText('AURA').width;
  ctx.fillStyle = '#F27D26';
  ctx.fillText('.', cardX + pad + auraWidth + 1, headerY);

  // Badge derecha (ej. FLAC HI-RES o STREAMING)
  const badgeText = song.format?.toLowerCase() === 'flac' ? 'HI-RES FLAC' : 'AURA MUSIC';
  ctx.font = '800 18px monospace';
  const badgeTextW = ctx.measureText(badgeText).width;
  const badgeW = badgeTextW + 32;
  const badgeH = 38;
  const badgeX = cardX + cardW - pad - badgeW;
  const badgeY = headerY - badgeH / 2;

  roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, 19);
  ctx.fillStyle = 'rgba(242, 125, 38, 0.16)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(242, 125, 38, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#F27D26';
  ctx.textAlign = 'center';
  ctx.fillText(badgeText, badgeX + badgeW / 2, headerY + 1);
  ctx.restore();

  // Portada cuadrada nítida dentro de la tarjeta
  const coverSize = cardW - pad * 2;
  const coverX = cardX + pad;
  const coverY = cardY + pad + 68;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 35;
  ctx.shadowOffsetY = 16;
  roundRectPath(ctx, coverX, coverY, coverSize, coverSize, 32);
  ctx.fillStyle = '#18181b';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, coverX, coverY, coverSize, coverSize, 32);
  ctx.clip();
  // Dibujar imagen centrada tipo cover
  const imgRatio = img.width / img.height;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (imgRatio > 1) {
    sw = img.height;
    sx = (img.width - sw) / 2;
  } else if (imgRatio < 1) {
    sh = img.width;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, coverX, coverY, coverSize, coverSize);
  ctx.restore();

  // Borde sutil de la portada
  ctx.save();
  roundRectPath(ctx, coverX, coverY, coverSize, coverSize, 32);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Título de la canción y Artista (estilo Tidal)
  const textStartY = coverY + coverSize + 52;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  ctx.font = '800 40px sans-serif';
  ctx.fillStyle = '#ffffff';
  const cleanTitle = truncateText(ctx, song.title || 'Canción', coverSize);
  ctx.fillText(cleanTitle, coverX, textStartY);

  ctx.font = '600 27px sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  const cleanArtist = truncateText(ctx, song.artist || 'Artista', coverSize);
  ctx.fillText(cleanArtist, coverX, textStartY + 54);

  // Barra de progreso minimalista estilo Tidal
  const barY = textStartY + 116;
  const barH = 6;
  roundRectPath(ctx, coverX, barY, coverSize, barH, 3);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.fill();

  const progressW = coverSize * 0.38;
  roundRectPath(ctx, coverX, barY, progressW, barH, 3);
  ctx.fillStyle = '#F27D26';
  ctx.fill();

  // Punto luminoso en la barra
  ctx.beginPath();
  ctx.arc(coverX + progressW, barY + barH / 2, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
}

export async function generateInstagramStoryAssets(song: Song): Promise<{
  fullStoryPngBase64: string;
  stickerPngBase64: string;
  topColor: string;
  bottomColor: string;
}> {
  const img = await loadSongCoverImage(song);
  const { topHex, bottomHex, rgb } = extractDominantColors(img);

  // 1. Generar el Sticker PNG transparente (Tarjeta estilo Tidal + Logo AURA) para vídeo animado
  const stickerCanvas = document.createElement('canvas');
  stickerCanvas.width = 920;
  stickerCanvas.height = 1220;
  const sCtx = stickerCanvas.getContext('2d')!;
  const sCardW = 800;
  const sCardH = 1040;
  const sCardX = (stickerCanvas.width - sCardW) / 2;
  const sCardY = (stickerCanvas.height - sCardH) / 2;
  drawTidalCardOnCanvas(sCtx, img, song, sCardX, sCardY, sCardW, sCardH, rgb);
  const stickerDataUrl = stickerCanvas.toDataURL('image/png');
  const stickerPngBase64 = stickerDataUrl.replace(/^data:image\/png;base64,/, '');

  // 2. Generar la imagen completa 9:16 (1080x1920) para portadas estáticas
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = 1080;
  fullCanvas.height = 1920;
  const fCtx = fullCanvas.getContext('2d')!;

  // Fondo: foto de la portada a pantalla completa con zoom y desenfoque atmosférico
  fCtx.save();
  const targetRatio = 1080 / 1920;
  const imgRatio = img.width / img.height;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (imgRatio > targetRatio) {
    sw = img.height * targetRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / targetRatio;
    sy = (img.height - sh) / 2;
  }
  fCtx.filter = 'blur(26px) saturate(1.25)';
  // Dibujar un poco más grande para evitar bordes blancos por el blur
  fCtx.drawImage(img, sx, sy, sw, sh, -60, -60, 1200, 2040);
  fCtx.restore();

  // Capa de viñeta oscura cinematográfica sobre el fondo
  const bgGrad = fCtx.createLinearGradient(0, 0, 0, 1920);
  bgGrad.addColorStop(0, 'rgba(8, 8, 12, 0.52)');
  bgGrad.addColorStop(0.5, 'rgba(8, 8, 12, 0.42)');
  bgGrad.addColorStop(1, 'rgba(5, 5, 8, 0.82)');
  fCtx.fillStyle = bgGrad;
  fCtx.fillRect(0, 0, 1080, 1920);

  // Dibujar la tarjeta Tidal en el centro del 1080x1920
  const fCardW = 820;
  const fCardH = 1060;
  const fCardX = (1080 - fCardW) / 2;
  const fCardY = (1920 - fCardH) / 2 - 20;
  drawTidalCardOnCanvas(fCtx, img, song, fCardX, fCardY, fCardW, fCardH, rgb);

  // Pie inferior sutil
  fCtx.save();
  fCtx.font = '700 22px sans-serif';
  fCtx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  fCtx.textAlign = 'center';
  fCtx.fillText('ESCÚCHALA EN AURA · AURA.BASILDO.ME', 540, 1810);
  fCtx.restore();

  const fullDataUrl = fullCanvas.toDataURL('image/png');
  const fullStoryPngBase64 = fullDataUrl.replace(/^data:image\/png;base64,/, '');

  return {
    fullStoryPngBase64,
    stickerPngBase64,
    topColor: topHex,
    bottomColor: bottomHex,
  };
}
