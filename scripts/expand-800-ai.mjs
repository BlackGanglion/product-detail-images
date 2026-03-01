#!/usr/bin/env node
/**
 * AI 扩图：将竖图扩展为 800x800 正方形，左右用 AI 自然延伸背景
 * 生成 黑橙色_800主图_01.jpg
 */
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { generateImage } from '../src/api/nanoBanana.js';
import { fileToBase64, mimeType, saveBase64Image } from '../src/utils/image.js';

const ROOT = process.cwd();
const inputPath = path.join(ROOT, '交付/羊605/1_精修图/全身照/黑橙色_全身_正面_4.jpg');
const outputPath = path.join(ROOT, '交付/羊605/4_800主图(天猫、C店、京东、拼多多)/黑橙色_800主图_01.jpg');

const OUTPAINT_PROMPT = `You are given a portrait-format product photo of a model wearing clothing against a studio background.

Your task: OUTPUT A SQUARE IMAGE (1:1 aspect ratio) that preserves the ENTIRE original image in the center, and NATURALLY EXTENDS the background on the left and right sides to fill the canvas.

STRICT RULES:
1. Keep the main subject (model + clothing) EXACTLY as shown — do NOT crop, zoom, move, or alter it.
2. Extend the background on BOTH left and right sides. The extended areas must seamlessly blend with the existing scene.
3. Match the original: same lighting, same colors, same background style, same atmosphere. No visible seams or boundaries.
4. The extended background should look like a natural continuation of the studio environment — walls, floor, shadows.
5. Output ONLY the square image. No borders, no text.`;

async function main() {
  console.log('读取原图...');
  const base64 = await fileToBase64(inputPath);
  const mime = mimeType(inputPath);

  console.log('调用 AI 扩图（左右延伸背景）...');
  const imageData = await generateImage(OUTPAINT_PROMPT, [
    { mimeType: mime, base64 },
  ], {
    aspectRatio: '1:1',
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await saveBase64Image(imageData, outputPath);

  // 统一 resize 到 800x800
  await sharp(outputPath)
    .resize(800, 800, { fit: 'fill' })
    .jpeg({ quality: 95 })
    .toFile(outputPath + '.tmp');
  await fs.rename(outputPath + '.tmp', outputPath);

  console.log('已生成:', outputPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
