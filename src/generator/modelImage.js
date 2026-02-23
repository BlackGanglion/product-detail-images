import path from 'path';
import pLimit from 'p-limit';
import config from '../../config/default.js';
import { generateImage } from '../api/nanoBanana.js';
import { frontPrompt, backPrompt } from '../prompts/templates.js';
import { fileToBase64, mimeType, listImages, saveBase64Image } from '../utils/image.js';

/**
 * Pick a random pose image from the poses directory.
 */
async function getRandomPose() {
  const poses = await listImages(config.poses.dir);
  if (poses.length === 0) throw new Error('No pose images found in poses/');
  const pick = poses[Math.floor(Math.random() * poses.length)];
  return { base64: await fileToBase64(pick), mimeType: mimeType(pick) };
}

/**
 * Generate front + back model images for a single clothing group.
 *
 * @param {object} params
 * @param {string} params.modelFrontPath - Model front reference photo
 * @param {string} params.modelBackPath  - Model back reference photo
 * @param {string} params.clothesFrontPath - Flat-lay clothing FRONT image
 * @param {string} params.clothesBackPath  - Flat-lay clothing BACK image
 * @param {string} params.groupId - Group identifier (for file naming)
 * @param {string} params.additionalNotes
 */
export async function generateForGroup({
  modelFrontPath,
  modelBackPath,
  clothesFrontPath,
  clothesBackPath,
  groupId,
  additionalNotes,
  outputDir,
}) {

  // Generate front: model front photo + clothes front flat-lay
  console.log(`  [${groupId}] Generating front image...`);
  const modelFrontBase64 = await fileToBase64(modelFrontPath);
  const modelFrontMime = mimeType(modelFrontPath);
  const clothesFrontBase64 = await fileToBase64(clothesFrontPath);
  const clothesFrontMime = mimeType(clothesFrontPath);
  const poseFront = await getRandomPose();

  const frontData = await generateImage(
    frontPrompt({ additionalNotes }),
    [
      { mimeType: modelFrontMime, base64: modelFrontBase64 },
      { mimeType: clothesFrontMime, base64: clothesFrontBase64 },
      { mimeType: poseFront.mimeType, base64: poseFront.base64 },
    ]
  );
  const frontPath = path.join(outputDir, `${groupId}-front.jpg`);
  await saveBase64Image(frontData, frontPath);
  console.log(`  [${groupId}] Front saved: ${frontPath}`);

  // Generate back: model back photo + clothes back flat-lay
  console.log(`  [${groupId}] Generating back image...`);
  const modelBackBase64 = await fileToBase64(modelBackPath);
  const modelBackMime = mimeType(modelBackPath);
  const clothesBackBase64 = await fileToBase64(clothesBackPath);
  const clothesBackMime = mimeType(clothesBackPath);
  const poseBack = await getRandomPose();

  const backData = await generateImage(
    backPrompt({ additionalNotes }),
    [
      { mimeType: modelBackMime, base64: modelBackBase64 },
      { mimeType: clothesBackMime, base64: clothesBackBase64 },
      { mimeType: poseBack.mimeType, base64: poseBack.base64 },
    ]
  );
  const backPath = path.join(outputDir, `${groupId}-back.jpg`);
  await saveBase64Image(backData, backPath);
  console.log(`  [${groupId}] Back saved: ${backPath}`);

  return { front: frontPath, back: backPath };
}

/**
 * Generate model images for all groups with concurrency control.
 */
export async function generateAllGroups({
  modelFrontPath,
  modelBackPath,
  groups, // [{ groupId, clothesFrontPath, clothesBackPath }]
  additionalNotes,
  outputDir,
}) {
  const limit = pLimit(config.generation.concurrency);

  const tasks = groups.map(g =>
    limit(() =>
      generateForGroup({
        modelFrontPath,
        modelBackPath,
        clothesFrontPath: g.clothesFrontPath,
        clothesBackPath: g.clothesBackPath,
        groupId: g.groupId,
        additionalNotes,
        outputDir,
      }).then(result => ({ groupId: g.groupId, ...result }))
    )
  );

  return Promise.all(tasks);
}

/**
 * Regenerate a single image (front or back) for a given group.
 */
export async function regenerateSingle({
  modelFrontPath,
  modelBackPath,
  clothesFrontPath,
  clothesBackPath,
  groupId,
  side, // 'front' or 'back'
  additionalNotes,
  outputDir,
}) {
  const pose = await getRandomPose();
  const isFront = side === 'front';

  const modelPath = isFront ? modelFrontPath : modelBackPath;
  const modelBase64 = await fileToBase64(modelPath);
  const modelMime = mimeType(modelPath);

  const clothesPath = isFront ? clothesFrontPath : clothesBackPath;
  const clothesBase64 = await fileToBase64(clothesPath);
  const clothesMime = mimeType(clothesPath);

  const promptFn = isFront ? frontPrompt : backPrompt;
  const promptText = promptFn({ additionalNotes });

  console.log(`  [${groupId}] Regenerating ${side} image...`);
  const imageData = await generateImage(promptText, [
    { mimeType: modelMime, base64: modelBase64 },
    { mimeType: clothesMime, base64: clothesBase64 },
    { mimeType: pose.mimeType, base64: pose.base64 },
  ]);

  const outputPath = path.join(outputDir, `${groupId}-${side}.jpg`);
  await saveBase64Image(imageData, outputPath);
  console.log(`  [${groupId}] ${side} regenerated: ${outputPath}`);

  return outputPath;
}
