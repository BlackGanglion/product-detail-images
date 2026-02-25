import path from 'path';
import pLimit from 'p-limit';
import config from '../../config/default.js';
import { generateImage } from '../api/nanoBanana.js';
import { clothingDetailPrompt } from '../prompts/clothingDetailTemplates.js';
import { fileToBase64, mimeType, saveBase64Image } from '../utils/image.js';

/**
 * Generate a single clothing detail image.
 *
 * @param {object} params
 * @param {string} params.detailRefPath - Detail reference photo (keep composition from this)
 * @param {string[]} params.clothingRefPaths - ALL clothing reference photos (replace clothing from these)
 * @param {string} params.additionalNotes - Optional extra instructions
 * @param {string} params.adjustmentPrompt - Optional adjustment for regeneration
 * @param {string} params.outputDir - Output directory
 * @param {number} params.index - Detail ref index (for file naming)
 * @returns {Promise<string>} - Path to the generated image
 */
export async function generateClothingDetail({
  detailRefPath,
  clothingRefPaths,
  additionalNotes,
  adjustmentPrompt,
  outputDir,
  index,
}) {
  const label = String(index + 1).padStart(2, '0');
  console.log(`  [clothing-detail-${label}] Generating clothing detail image...`);

  // Build image array: detail ref first, then all clothing refs
  const images = [];

  const detailBase64 = await fileToBase64(detailRefPath);
  const detailMime = mimeType(detailRefPath);
  images.push({ mimeType: detailMime, base64: detailBase64 });

  for (const clothingPath of clothingRefPaths) {
    const clothingBase64 = await fileToBase64(clothingPath);
    const clothingMime = mimeType(clothingPath);
    images.push({ mimeType: clothingMime, base64: clothingBase64 });
  }

  const promptText = clothingDetailPrompt({
    additionalNotes,
    adjustmentPrompt,
    clothingCount: clothingRefPaths.length,
  });

  const imageData = await generateImage(promptText, images);

  const outputPath = path.join(outputDir, `result-${label}.jpg`);
  await saveBase64Image(imageData, outputPath);
  console.log(`  [clothing-detail-${label}] Saved: ${outputPath}`);

  return outputPath;
}

/**
 * Batch generate clothing detail images with concurrency control.
 * Each detail ref generates one result using ALL clothing ref photos.
 *
 * @param {object} params
 * @param {Array<{index: number, path: string}>} params.detailRefs - Detail references to process (N tasks)
 * @param {string[]} params.clothingRefPaths - ALL clothing reference photo paths (shared across tasks)
 * @param {string} params.additionalNotes - Optional extra instructions
 * @param {string} params.outputDir - Output directory
 * @returns {Promise<Array<{index: number, path: string}>>}
 */
export async function generateAllClothingDetails({
  detailRefs,
  clothingRefPaths,
  additionalNotes,
  outputDir,
}) {
  const limit = pLimit(config.generation.concurrency);

  const tasks = detailRefs.map(ref =>
    limit(() =>
      generateClothingDetail({
        detailRefPath: ref.path,
        clothingRefPaths,
        additionalNotes,
        outputDir,
        index: ref.index,
      }).then(outputPath => ({ index: ref.index, path: outputPath }))
    )
  );

  return Promise.all(tasks);
}
