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
    c.width = 6;
    c.height = 6;
    const ctx = c.getContext('2d');
    if (!ctx) return { topHex: '#141418', bottomHex: '#070709', rgb: [242, 125, 38] };
    ctx.drawImage(img, 0, 0, 6, 6);
    const data = ctx.getImageData(0, 0, 6, 6).data;
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
    const topHex = `#${toHex(r * 0.42)}${toHex(g * 0.42)}${toHex(b * 0.42)}`;
    const bottomHex = `#${toHex(r * 0.14)}${toHex(g * 0.14)}${toHex(b * 0.14)}`;
    return { topHex, bottomHex, rgb: [r, g, b] };
  } catch {
    return { topHex: '#141418', bottomHex: '#070709', rgb: [242, 125, 38] };
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
  const pad = 42;
  const cardRadius = 46;

  // 1. Sombra exterior suave y profunda
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.78)';
  ctx.shadowBlur = 75;
  ctx.shadowOffsetY = 32;
  roundRectPath(ctx, cardX, cardY, cardW, cardH, cardRadius);
  ctx.fillStyle = 'rgba(13, 13, 17, 0.88)';
  ctx.fill();
  ctx.restore();

  // 2. Luz ambiental sutil de la propia portada dentro de la tarjeta
  ctx.save();
  roundRectPath(ctx, cardX, cardY, cardW, cardH, cardRadius);
  ctx.clip();
  const cardGlow = ctx.createRadialGradient(
    cardX + cardW / 2,
    cardY + cardW * 0.45,
    40,
    cardX + cardW / 2,
    cardY + cardW * 0.55,
    cardW * 0.9
  );
  cardGlow.addColorStop(0, `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, 0.25)`);
  cardGlow.addColorStop(0.65, `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, 0.08)`);
  cardGlow.addColorStop(1, 'rgba(13, 13, 17, 0)');
  ctx.fillStyle = cardGlow;
  ctx.fillRect(cardX, cardY, cardW, cardH);
  ctx.restore();

  // 3. Borde cristalino fino
  ctx.save();
  roundRectPath(ctx, cardX, cardY, cardW, cardH, cardRadius);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // 4. Portada cuadrada protagonista en la parte superior (como en Tidal)
  const coverSize = cardW - pad * 2;
  const coverX = cardX + pad;
  const coverY = cardY + pad;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.62)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  roundRectPath(ctx, coverX, coverY, coverSize, coverSize, 30);
  ctx.fillStyle = '#141418';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, coverX, coverY, coverSize, coverSize, 30);
  ctx.clip();
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

  ctx.save();
  roundRectPath(ctx, coverX, coverY, coverSize, coverSize, 30);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // 5. Título de la canción y Artista debajo de la portada
  const textStartY = coverY + coverSize + 44;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  ctx.font = '800 38px sans-serif';
  ctx.fillStyle = '#ffffff';
  const cleanTitle = truncateText(ctx, song.title || 'Canción', coverSize);
  ctx.fillText(cleanTitle, coverX, textStartY);

  ctx.font = '500 26px sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.60)';
  const cleanArtist = truncateText(ctx, song.artist || 'Artista', coverSize);
  ctx.fillText(cleanArtist, coverX, textStartY + 52);
  ctx.restore();

  // 6. Separador sutil y pie con el logo AURA. + icono de ondas minimalista
  const dividerY = textStartY + 114;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(coverX, dividerY);
  ctx.lineTo(coverX + coverSize, dividerY);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const footerCenterY = dividerY + 42;
  ctx.font = '900 28px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('AURA', coverX, footerCenterY);
  const auraW = ctx.measureText('AURA').width;
  ctx.fillStyle = '#F27D26';
  ctx.fillText('.', coverX + auraW + 1, footerCenterY);

  // Pequeño ecualizador estético a la derecha del pie
  const eqRightX = coverX + coverSize;
  const barHeights = [14, 24, 18, 28, 16];
  const barWidth = 4;
  const barGap = 5;
  for (let i = 0; i < barHeights.length; i++) {
    const bh = barHeights[i];
    const bx = eqRightX - (barHeights.length - i) * (barWidth + barGap) + barGap;
    const by = footerCenterY - bh / 2;
    roundRectPath(ctx, bx, by, barWidth, bh, 2);
    ctx.fillStyle = i === 3 ? '#F27D26' : 'rgba(255, 255, 255, 0.35)';
    ctx.fill();
  }
  ctx.restore();
}

function drawBottomRightDomainWatermark(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.font = '500 22px sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.50)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
  ctx.shadowBlur = 8;
  ctx.fillText('aura.basildo.me', 1036, 1876);
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

  const cardW = 780;
  const cardH = 995;
  const cardX = (1080 - cardW) / 2;
  const cardY = Math.round((1920 - cardH) / 2);

  // 1. Generar Overlay PNG 1080x1920 transparente (Viñeta suave + Tarjeta estilo Tidal + aura.basildo.me abajo a la derecha)
  // Se superpone directamente sobre el vídeo animado 9:16 en Android usando Media3 Transformer
  const stickerCanvas = document.createElement('canvas');
  stickerCanvas.width = 1080;
  stickerCanvas.height = 1920;
  const sCtx = stickerCanvas.getContext('2d')!;

  const videoVignette = sCtx.createLinearGradient(0, 0, 0, 1920);
  videoVignette.addColorStop(0, 'rgba(6, 6, 10, 0.32)');
  videoVignette.addColorStop(0.5, 'rgba(6, 6, 10, 0.18)');
  videoVignette.addColorStop(1, 'rgba(4, 4, 7, 0.65)');
  sCtx.fillStyle = videoVignette;
  sCtx.fillRect(0, 0, 1080, 1920);

  drawTidalCardOnCanvas(sCtx, img, song, cardX, cardY, cardW, cardH, rgb);
  drawBottomRightDomainWatermark(sCtx);

  const stickerDataUrl = stickerCanvas.toDataURL('image/png');
  const stickerPngBase64 = stickerDataUrl.replace(/^data:image\/png;base64,/, '');

  // 2. Generar imagen completa 9:16 (1080x1920) para canciones con portada estática
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = 1080;
  fullCanvas.height = 1920;
  const fCtx = fullCanvas.getContext('2d')!;

  // Fondo: foto de la portada a pantalla completa con desenfoque suave y saturación rica
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
  fCtx.filter = 'blur(34px) saturate(1.3)';
  fCtx.drawImage(img, sx, sy, sw, sh, -80, -80, 1240, 2080);
  fCtx.restore();

  // Viñeta cinematográfica suave para dar protagonismo a la tarjeta central
  const bgGrad = fCtx.createLinearGradient(0, 0, 0, 1920);
  bgGrad.addColorStop(0, 'rgba(6, 6, 10, 0.48)');
  bgGrad.addColorStop(0.5, 'rgba(6, 6, 10, 0.35)');
  bgGrad.addColorStop(1, 'rgba(4, 4, 7, 0.78)');
  fCtx.fillStyle = bgGrad;
  fCtx.fillRect(0, 0, 1080, 1920);

  // Tarjeta centrada en el lienzo 1080x1920
  drawTidalCardOnCanvas(fCtx, img, song, cardX, cardY, cardW, cardH, rgb);
  drawBottomRightDomainWatermark(fCtx);

  const fullDataUrl = fullCanvas.toDataURL('image/png');
  const fullStoryPngBase64 = fullDataUrl.replace(/^data:image\/png;base64,/, '');

  return {
    fullStoryPngBase64,
    stickerPngBase64,
    topColor: topHex,
    bottomColor: bottomHex,
  };
}
