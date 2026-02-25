import path from 'path';
import pLimit from 'p-limit';
import config from '../../config/default.js';
import { generateImage } from '../api/nanoBanana.js';
import { retouchPrompt } from '../prompts/retouchTemplates.js';
import { fileToBase64, mimeType, saveBase64Image } from '../utils/image.js';

/**
 * Generate a single retouched image (clothing swap).
 *
 * @param {object} params
 * @param {string} params.modelRefPath - Model reference photo (keep everything from this)
 * @param {string[]} params.clothingRefPaths - ALL clothing reference photos (swap clothing from these)
 * @param {string} params.additionalNotes - Optional extra instructions
 * @param {string} params.adjustmentPrompt - Optional adjustment for regeneration
 * @param {string} params.outputDir - Output directory
 * @param {number} params.index - Model ref index (for file naming)
 * @returns {Promise<string>} - Path to the generated image
 */
export async function generateRetouch({
  modelRefPath,
  clothingRefPaths,
  additionalNotes,
  adjustmentPrompt,
  outputDir,
  index,
}) {
  const label = String(index + 1).padStart(2, '0');
  console.log(`  [retouch-${label}] Generating retouched image...`);

  // Build image array: model ref first, then all clothing refs
  const images = [];

  const modelBase64 = await fileToBase64(modelRefPath);
  const modelMime = mimeType(modelRefPath);
  images.push({ mimeType: modelMime, base64: modelBase64 });

  for (const clothingPath of clothingRefPaths) {
    const clothingBase64 = await fileToBase64(clothingPath);
    const clothingMime = mimeType(clothingPath);
    images.push({ mimeType: clothingMime, base64: clothingBase64 });
  }

  const promptText = retouchPrompt({
    additionalNotes,
    adjustmentPrompt,
    clothingCount: clothingRefPaths.length,
  });

  const imageData = await generateImage(promptText, images);

  const outputPath = path.join(outputDir, `result-${label}.jpg`);
  await saveBase64Image(imageData, outputPath);
  console.log(`  [retouch-${label}] Saved: ${outputPath}`);

  return outputPath;
}

/**
 * Batch generate retouched images with concurrency control.
 * Each model ref generates one result using ALL clothing ref photos.
 *
 * @param {object} params
 * @param {Array<{index: number, path: string}>} params.modelRefs - Model references to process (N tasks)
 * @param {string[]} params.clothingRefPaths - ALL clothing reference photo paths (shared across tasks)
 * @param {string} params.additionalNotes - Optional extra instructions
 * @param {string} params.outputDir - Output directory
 * @returns {Promise<Array<{index: number, path: string}>>}
 */
export async function generateAllRetouches({
  modelRefs,
  clothingRefPaths,
  additionalNotes,
  outputDir,
}) {
  const limit = pLimit(config.generation.concurrency);

  const tasks = modelRefs.map(ref =>
    limit(() =>
      generateRetouch({
        modelRefPath: ref.path,
        clothingRefPaths,
        additionalNotes,
        outputDir,
        index: ref.index,
      }).then(outputPath => ({ index: ref.index, path: outputPath }))
    )
  );

  return Promise.all(tasks);
}
