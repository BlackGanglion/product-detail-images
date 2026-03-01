#!/usr/bin/env node
/**
 * 修复 羊605款 黑橙色_全身_敞开_3
 * 使用已通过的正面_4作为花色参考（代替实拍mannequin图）
 */
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { generateImage } from '../src/api/nanoBanana.js';
import { fileToBase64, mimeType, saveBase64Image } from '../src/utils/image.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function loadImage(relPath) {
  const abs = path.join(ROOT, relPath);
  return { base64: await fileToBase64(abs), mimeType: mimeType(abs) };
}

async function main() {
  // Image 1: 参考姿势图（敞开_3 pose）
  const refPose = await loadImage('参考/1_精修图/全身照-{花色}/全身_敞开_3.JPG');

  // Image 2: 已通过的正面_4作为花色参考
  const colorRef = await loadImage('交付/羊605/1_精修图/全身照/黑橙色_全身_正面_4.jpg');

  const prompt = `You are given two images. Image 1 is the REFERENCE photo. Image 2 shows a model wearing the TARGET sweater.

Your task: reproduce Image 1 EXACTLY — same model, same pose, same background, same full-body framing — but replace the vest/top with the SAME sweater from Image 2.

The sweater is a BLACK knit PULLOVER with horizontal pattern bands: V-neckline → beige speckled gradient → orange baroque scrollwork band → beige gradient → solid black body. Gold rhinestone beads run vertically down center front. Batwing sleeves, ribbed cuffs and waistband.

IMPORTANT: This is a PULLOVER with NO front opening. The front is one continuous piece of fabric. The model should wear it pulled on normally (closed). Replace both the vest and black top from Image 1. Keep same pose, full body visible head to toe.

Copy the sweater pattern and colors EXACTLY from Image 2. Everything else from Image 1 stays identical.`;

  const images = [
    { base64: refPose.base64, mimeType: refPose.mimeType },
    { base64: colorRef.base64, mimeType: colorRef.mimeType },
  ];

  console.log('生成中: 黑橙色_全身_敞开_3 (使用正面_4作为花色参考)...');
  const result = await generateImage(prompt, images, { aspectRatio: '2:3' });

  if (!result?.base64) {
    console.error('生成失败');
    process.exit(1);
  }

  const outputPath = path.join(ROOT, '交付/羊605/1_精修图/全身照/黑橙色_全身_敞开_3.jpg');
  const tmpPath = outputPath + '.tmp.png';
  await saveBase64Image(result.base64, tmpPath);
  await sharp(tmpPath).resize(2000, 3000, { fit: 'fill' }).jpeg({ quality: 95 }).toFile(outputPath);
  const fs = await import('fs/promises');
  await fs.unlink(tmpPath);

  console.log(`完成: 黑橙色_全身_敞开_3.jpg (2000x3000)`);
}

main().catch(err => { console.error(err); process.exit(1); });
