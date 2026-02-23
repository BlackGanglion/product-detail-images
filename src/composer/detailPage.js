import path from 'path';
import sharp from 'sharp';
import config from '../../config/default.js';
import { generateImage } from '../api/nanoBanana.js';
import { detailPagePrompt } from '../prompts/templates.js';
import { fileToBase64, mimeType, saveBase64Image } from '../utils/image.js';

/**
 * Generate a single detail page section.
 *
 * @param {object} params
 * @param {string} params.refImagePath - Detail page reference image
 * @param {string[]} params.modelImagePaths - Step1 model wearing images to include
 * @param {number} params.index - Section index (for naming)
 * @returns {Promise<string>} - Output file path
 */
export async function generateSection({ refImagePath, modelImagePaths, index, outputDir }) {
  const label = String(index + 1).padStart(2, '0');

  console.log(`  [section-${label}] Generating...`);

  const images = [];

  // First image: the reference
  images.push({
    mimeType: mimeType(refImagePath),
    base64: await fileToBase64(refImagePath),
  });

  // Remaining images: model wearing photos
  for (const p of modelImagePaths) {
    images.push({
      mimeType: mimeType(p),
      base64: await fileToBase64(p),
    });
  }

  const imageData = await generateImage(detailPagePrompt(), images);
  const outputPath = path.join(outputDir, `section-${label}.jpg`);
  await saveBase64Image(imageData, outputPath);
  console.log(`  [section-${label}] Saved: ${outputPath}`);

  return outputPath;
}

/**
 * Stitch all section images vertically into a final long image.
 *
 * @param {string[]} sectionPaths - Ordered section image paths
 * @returns {Promise<string>} - Final output path
 */
export async function stitchSections(sectionPaths, { outputDir } = {}) {
  const targetWidth = config.detailPage.width;
  const outputPath = path.join(outputDir, 'detail-page.jpg');

  // Resize all sections to target width and collect buffers + heights
  const resized = [];
  for (const p of sectionPaths) {
    const buf = await sharp(p)
      .resize({ width: targetWidth })
      .jpeg({ quality: 95 })
      .toBuffer();
    const meta = await sharp(buf).metadata();
    resized.push({ buffer: buf, width: meta.width, height: meta.height });
  }

  const totalHeight = resized.reduce((sum, r) => sum + r.height, 0);

  // Composite all sections vertically
  const composites = [];
  let y = 0;
  for (const r of resized) {
    composites.push({ input: r.buffer, top: y, left: 0 });
    y += r.height;
  }

  await sharp({
    create: {
      width: targetWidth,
      height: totalHeight,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 95 })
    .toFile(outputPath);

  console.log(`  Final stitched image: ${outputPath} (${targetWidth}x${totalHeight})`);
  return outputPath;
}
