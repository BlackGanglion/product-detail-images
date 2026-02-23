import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

/**
 * Read a file and return its base64-encoded content.
 */
export async function fileToBase64(filePath) {
  const buf = await fs.readFile(filePath);
  return buf.toString('base64');
}

/**
 * Get image dimensions.
 */
export async function getImageSize(filePath) {
  const meta = await sharp(filePath).metadata();
  return { width: meta.width, height: meta.height };
}

/**
 * Get the MIME type for common image extensions.
 */
export function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  return map[ext] || 'image/jpeg';
}

/**
 * Save a base64-encoded image to disk.
 */
export async function saveBase64Image(base64Data, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const buf = Buffer.from(base64Data, 'base64');
  await fs.writeFile(outputPath, buf);
  return outputPath;
}

/**
 * List image files in a directory sorted by name.
 */
export async function listImages(dir) {
  const exts = new Set(['.jpg', '.jpeg', '.png', '.webp']);
  const entries = await fs.readdir(dir);
  return entries
    .filter(f => exts.has(path.extname(f).toLowerCase()))
    .sort()
    .map(f => path.join(dir, f));
}
