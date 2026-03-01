#!/usr/bin/env node
/**
 * 从已有 2000x3000 全身照裁剪/缩放出各尺寸主图。
 * 按花色成套生成：每个花色独立产出 3:4主图、800主图（全身/半身/2拼/3拼/宣传图）、800细节图、1200主图、6_800白色透明底 等。800主图_宣传图：参照 800主图_主花色_宣传图 4 张，将模特区替换为该款精修图-全身照-正面。
 * 3:4主图、1200主图、3拼、800主图半身：纯程序裁剪/拼接。
 * 800主图单人（4张）：AI 扩图。800主图 2拼：依赖已生成的 全身4张+半身4张，程序横拼。1200主图 2拼：用 800主图_半身_01+800主图_01，输出 800×1200。
 * 用法: node scripts/crop-from-fullbody.js <款式名> [花色...]
 * 例:   node scripts/crop-from-fullbody.js 羊605          # 该款下所有花色各生成一套
 *       node scripts/crop-from-fullbody.js 羊605 黑橙色   # 仅生成指定花色
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { generateImage } from '../src/api/nanoBanana.js';
import { fileToBase64, mimeType, saveBase64Image } from '../src/utils/image.js';

const ROOT = process.cwd();
const DELIVERY_DIR = path.join(ROOT, '交付');
const REF_XUANCHUAN_DIR = path.join(ROOT, '参考/4_800主图(天猫、C店、京东、拼多多)/800主图_主花色_宣传图');

// 全身照文件名后缀 → 分类（正面/侧面/背面/敞开）
const POSE_MAP = {
  全身_正面_1: '正面',
  全身_正面_4: '正面',
  全身_正面_5: '正面',
  全身_正面_6: '正面',
  全身_侧面_2: '侧面',
  全身_背面_7: '背面',
  全身_敞开_3: '敞开',
};

const SRC_W = 2000;
const SRC_H = 3000;

const OUTPAINT_PROMPT = `You are given a portrait-format product photo of a model wearing clothing against a studio background.

Your task: OUTPUT A SQUARE IMAGE (1:1 aspect ratio) that preserves the ENTIRE original image in the center, and NATURALLY EXTENDS the background on the left and right sides to fill the canvas.

STRICT RULES:
1. Keep the main subject (model + clothing) EXACTLY as shown — do NOT crop, zoom, move, or alter it.
2. Extend the background on BOTH left and right sides. The extended areas must seamlessly blend with the existing scene.
3. Match the original: same lighting, same colors, same background style, same atmosphere. No visible seams or boundaries.
4. The extended background should look like a natural continuation of the studio environment — walls, floor, shadows.
5. Output ONLY the square image. No borders, no text.`;

async function listFullbodyByColor(fullbodyDir) {
  const files = await fs.readdir(fullbodyDir).catch(() => []);
  const byColor = {};
  for (const f of files) {
    if (!/\.(jpg|jpeg|png)$/i.test(f)) continue;
    const base = path.basename(f, path.extname(f));
    const match = base.match(/^(.+?)_(全身_[^_]+_\d)$/);
    if (!match) continue;
    const [, color, suffix] = match;
    if (!POSE_MAP[suffix]) continue;
    if (!byColor[color]) byColor[color] = {};
    byColor[color][suffix] = path.join(fullbodyDir, f);
  }
  return byColor;
}

/** 从 2000x3000 中心裁剪出比例 ratio = width/height，再缩放到 (outW, outH) */
async function cropToRatio(inputPath, outW, outH, ratio, outputPath) {
  const cropW = Math.min(SRC_W, Math.round(SRC_H * ratio));
  const cropH = Math.min(SRC_H, Math.round(SRC_W / ratio));
  const left = Math.max(0, Math.floor((SRC_W - cropW) / 2));
  const top = Math.max(0, Math.floor((SRC_H - cropH) / 2));
  await sharp(inputPath)
    .extract({ left, top, width: cropW, height: cropH })
    .resize(outW, outH, { fit: 'fill' })
    .jpeg({ quality: 95 })
    .toFile(outputPath);
}

/** 宣传图：将参考图上的模特替换为该款模特（不带背景），其余不变，用 AI 生成 */
const XUANCHUAN_SWAP_PROMPT = `You are given two images.
Image 1 is a promotional product template: it has a model/person on one side and text/graphics (e.g. "5大保障", feature labels) on the other side, with a plain background.
Image 2 shows the same type of product worn by a model (full-body front view).

Your task: OUTPUT a single image that is EXACTLY like Image 1 in layout, background, text, graphics, and composition — but REPLACE ONLY THE MODEL/PERSON in Image 1 with the model from Image 2. The person in the output must be the person from Image 2 (same pose, same clothing, same appearance). Do NOT bring any background from Image 2; the background and all text must remain exactly as in Image 1. Only the human figure is swapped. Output 800×800 square.`;

async function xuanchuanSwapModel(refPath, modelPath, outputPath) {
  const refBase64 = await fileToBase64(refPath);
  const modelBase64 = await fileToBase64(modelPath);
  const imageData = await generateImage(XUANCHUAN_SWAP_PROMPT, [
    { mimeType: mimeType(refPath), base64: refBase64 },
    { mimeType: mimeType(modelPath), base64: modelBase64 },
  ], { aspectRatio: '1:1' });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await saveBase64Image(imageData, outputPath);
  await sharp(outputPath)
    .resize(800, 800, { fit: 'fill' })
    .jpeg({ quality: 95 })
    .toFile(outputPath + '.tmp');
  await fs.rename(outputPath + '.tmp', outputPath);
}

/** AI 扩图：将竖图 2000x3000 扩展为 800x800 正方形，左右自然延伸背景 */
async function expand800Ai(inputPath, outputPath) {
  const base64 = await fileToBase64(inputPath);
  const mime = mimeType(inputPath);
  const imageData = await generateImage(OUTPAINT_PROMPT, [{ mimeType: mime, base64 }], {
    aspectRatio: '1:1',
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await saveBase64Image(imageData, outputPath);
  await sharp(outputPath)
    .resize(800, 800, { fit: 'fill' })
    .jpeg({ quality: 95 })
    .toFile(outputPath + '.tmp');
  await fs.rename(outputPath + '.tmp', outputPath);
}

/** 直接等比缩放到 800x1200（2:3 与 2000x3000 一致） */
async function resize23(inputPath, outputPath) {
  await sharp(inputPath)
    .resize(800, 1200, { fit: 'fill' })
    .jpeg({ quality: 95 })
    .toFile(outputPath);
}

/** 从图片上下边缘采样平均色（用于 letterbox 上下填充） */
async function getEdgeColorTopBottom(imageBuffer, width, height, sampleH = 40) {
  const sample = Math.min(sampleH, height);
  const topBuf = await sharp(imageBuffer)
    .extract({ left: 0, top: 0, width, height: sample })
    .resize(1, 1)
    .raw()
    .toBuffer();
  const bottomBuf = await sharp(imageBuffer)
    .extract({ left: 0, top: Math.max(0, height - sample), width, height: sample })
    .resize(1, 1)
    .raw()
    .toBuffer();
  return {
    r: Math.round((topBuf[0] + bottomBuf[0]) / 2),
    g: Math.round((topBuf[1] + bottomBuf[1]) / 2),
    b: Math.round((topBuf[2] + bottomBuf[2]) / 2),
  };
}

/** 从图片左右边缘采样平均色（用于 letterbox 左右填充） */
async function getEdgeColorLeftRight(imageBuffer, width, height, sampleW = 40) {
  const leftBuf = await sharp(imageBuffer)
    .extract({ left: 0, top: 0, width: Math.min(sampleW, width), height })
    .resize(1, 1)
    .raw()
    .toBuffer();
  const rightBuf = await sharp(imageBuffer)
    .extract({ left: Math.max(0, width - sampleW), top: 0, width: Math.min(sampleW, width), height })
    .resize(1, 1)
    .raw()
    .toBuffer();
  const r = Math.round((leftBuf[0] + rightBuf[0]) / 2);
  const g = Math.round((leftBuf[1] + rightBuf[1]) / 2);
  const b = Math.round((leftBuf[2] + rightBuf[2]) / 2);
  return { r, g, b };
}

/** 截取大腿以上：参照 800主图_7 的人物位置和大小，人物上下居中占满，左右不足用边缘色填充 */
async function cropAboveWaist(inputPath, outputPath) {
  const h = Math.floor(SRC_H * 0.55); // 大腿以上约 55%
  const aboveThigh = await sharp(inputPath)
    .extract({ left: 0, top: 0, width: SRC_W, height: h })
    .resize(800, 800, { fit: 'cover', position: 'center' }) // 人物占满 800 高，居中裁剪
    .jpeg({ quality: 95 })
    .toBuffer();

  const meta = await sharp(aboveThigh).metadata();
  if (meta.width === 800 && meta.height === 800) {
    await sharp(aboveThigh).toFile(outputPath);
    return;
  }
  // 若宽不足 800（fit:cover 理论上会得到 800x800），用边缘色填充左右
  const imgW = meta.width;
  const imgH = meta.height;
  const bg = await getEdgeColorLeftRight(aboveThigh, imgW, imgH);
  const padLeft = Math.floor((800 - imgW) / 2);
  await sharp({
    create: { width: 800, height: 800, channels: 3, background: bg },
  })
    .composite([{ input: aboveThigh, left: padLeft, top: Math.floor((800 - imgH) / 2) }])
    .jpeg({ quality: 95 })
    .toFile(outputPath);
}

/** 取上半身：上 1/2 即 2000x1500，再缩放到目标尺寸 */
async function cropHalfBody(inputPath, outW, outH, outputPath) {
  await sharp(inputPath)
    .extract({ left: 0, top: 0, width: SRC_W, height: Math.floor(SRC_H / 2) })
    .resize(outW, outH, { fit: 'fill' })
    .jpeg({ quality: 95 })
    .toFile(outputPath);
}

/** 把多张图横拼成一张：每张先 resize 到 (cellW, cellH)，再横向拼接 */
async function stitchHorizontal(imagePaths, cellW, cellH, outputPath) {
  const buffers = [];
  for (const p of imagePaths) {
    const buf = await sharp(p)
      .resize(cellW, cellH, { fit: 'cover' })
      .jpeg({ quality: 95 })
      .toBuffer();
    buffers.push(buf);
  }
  const totalW = cellW * buffers.length;
  const composites = buffers.map((buf, i) => ({ input: buf, left: i * cellW, top: 0 }));
  await sharp({
    create: {
      width: totalW,
      height: cellH,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 95 })
    .toFile(outputPath);
}

/** 2拼图：左:右 = 4.5:3.5，总宽 800，即左 450px 右 350px */
const TWO_PANEL_RATIO_LEFT = 4.5;
const TWO_PANEL_RATIO_RIGHT = 3.5;
const TWO_PANEL_TOTAL_W = 800;
const TWO_PANEL_LEFT_W = Math.round(TWO_PANEL_TOTAL_W * (TWO_PANEL_RATIO_LEFT / (TWO_PANEL_RATIO_LEFT + TWO_PANEL_RATIO_RIGHT)));
const TWO_PANEL_RIGHT_W = TWO_PANEL_TOTAL_W - TWO_PANEL_LEFT_W;
const TWO_PANEL_H = 800;

async function stitchTwoPanel(leftPath, rightPath, outputPath) {
  const leftBuf = await sharp(leftPath)
    .resize(TWO_PANEL_LEFT_W, TWO_PANEL_H, { fit: 'cover' })
    .jpeg({ quality: 95 })
    .toBuffer();
  const rightBuf = await sharp(rightPath)
    .resize(TWO_PANEL_RIGHT_W, TWO_PANEL_H, { fit: 'cover' })
    .jpeg({ quality: 95 })
    .toBuffer();
  await sharp({
    create: { width: 800, height: TWO_PANEL_H, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([
      { input: leftBuf, left: 0, top: 0 },
      { input: rightBuf, left: TWO_PANEL_LEFT_W, top: 0 },
    ])
    .jpeg({ quality: 95 })
    .toFile(outputPath);
}

/** 1200主图 2拼：参照 参考/5_1200主图/1200主图_{花色}_2拼图.jpg 大小分布，左 492px 右 308px，总 800×1200。左右用 fit:inside 保留完整人物，上下留白填边缘色 */
const TWO_PANEL_1200_H = 1200;
const TWO_PANEL_1200_LEFT_W = 492;  // 参照参考图检测分界
const TWO_PANEL_1200_RIGHT_W = 308;

async function stitchTwoPanel1200(leftPath, rightPath, outputPath) {
  const leftW = TWO_PANEL_1200_LEFT_W;
  const rightW = TWO_PANEL_1200_RIGHT_W;

  const leftResized = await sharp(leftPath)
    .resize(leftW, TWO_PANEL_1200_H, { fit: 'inside' })
    .jpeg({ quality: 95 })
    .toBuffer();
  const leftMeta = await sharp(leftResized).metadata();
  const leftBg = await getEdgeColorTopBottom(leftResized, leftMeta.width, leftMeta.height);
  const leftTop = Math.floor((TWO_PANEL_1200_H - leftMeta.height) / 2);
  const leftPanel = await sharp({
    create: { width: leftW, height: TWO_PANEL_1200_H, channels: 3, background: leftBg },
  })
    .composite([{ input: leftResized, left: 0, top: leftTop }])
    .jpeg({ quality: 95 })
    .toBuffer();

  const rightResized = await sharp(rightPath)
    .resize(rightW, TWO_PANEL_1200_H, { fit: 'inside' })
    .jpeg({ quality: 95 })
    .toBuffer();
  const rightMeta = await sharp(rightResized).metadata();
  const rightBg = await getEdgeColorTopBottom(rightResized, rightMeta.width, rightMeta.height);
  const rightTop = Math.floor((TWO_PANEL_1200_H - rightMeta.height) / 2);
  const rightPanel = await sharp({
    create: { width: rightW, height: TWO_PANEL_1200_H, channels: 3, background: rightBg },
  })
    .composite([{ input: rightResized, left: 0, top: rightTop }])
    .jpeg({ quality: 95 })
    .toBuffer();

  await sharp({
    create: { width: 800, height: TWO_PANEL_1200_H, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([
      { input: leftPanel, left: 0, top: 0 },
      { input: rightPanel, left: leftW, top: 0 },
    ])
    .jpeg({ quality: 95 })
    .toFile(outputPath);
}

/** 竖拼：多张图各 resize 到 (cellW, cellH) 后上下拼接 → 总尺寸 cellW x (cellH * n) */
async function stitchVertical(imagePaths, cellW, cellH, outputPath) {
  const buffers = [];
  for (const p of imagePaths) {
    const buf = await sharp(p)
      .resize(cellW, cellH, { fit: 'cover' })
      .jpeg({ quality: 95 })
      .toBuffer();
    buffers.push(buf);
  }
  const totalH = cellH * buffers.length;
  const composites = buffers.map((buf, i) => ({ input: buf, left: 0, top: i * cellH }));
  await sharp({
    create: {
      width: cellW,
      height: totalH,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 95 })
    .toFile(outputPath);
}

function pickByPose(bySuffix, pose, preferSuffixes) {
  for (const s of preferSuffixes) {
    if (bySuffix[s]) return bySuffix[s];
  }
  for (const [suffix, file] of Object.entries(bySuffix)) {
    if (POSE_MAP[suffix] === pose) return file;
  }
  return null;
}

async function runForColor(color, bySuffix, baseOutDir) {
  const frontFiles = [
    pickByPose(bySuffix, '正面', ['全身_正面_4', '全身_正面_5', '全身_正面_6', '全身_正面_1']),
    pickByPose(bySuffix, '正面', ['全身_正面_5', '全身_正面_6', '全身_正面_4', '全身_正面_1']),
    pickByPose(bySuffix, '正面', ['全身_正面_6', '全身_正面_4', '全身_正面_5', '全身_正面_1']),
  ].filter(Boolean);
  const sideFile = pickByPose(bySuffix, '侧面', ['全身_侧面_2']);
  const backFile = pickByPose(bySuffix, '背面', ['全身_背面_7']);

  const dir34 = path.join(baseOutDir, '3_3比4主图750x1000');
  const dir800 = path.join(baseOutDir, '4_800主图(天猫、C店、京东、拼多多)');
  const dir800Detail = path.join(dir800, '800细节图');
  const dir800Xuanchuan = path.join(dir800, '800主图_宣传图');
  const dir1200 = path.join(baseOutDir, '5_1200主图');
  const dir6 = path.join(baseOutDir, '6_800白色透明底');
  const detailDir = path.join(baseOutDir, '1_精修图', '细节图');

  // 以下均按当前花色成套生成（多花色款式会逐花色执行 runForColor）
  await fs.mkdir(dir34, { recursive: true });
  await fs.mkdir(dir800, { recursive: true });
  await fs.mkdir(dir800Detail, { recursive: true });
  await fs.mkdir(dir800Xuanchuan, { recursive: true });
  await fs.mkdir(dir1200, { recursive: true });
  await fs.mkdir(dir6, { recursive: true });

  // ---------- 750x1000 每花色 3 张正面 ----------
  for (let i = 0; i < Math.min(3, frontFiles.length); i++) {
    const out = path.join(dir34, `${color}_3比4主图_${String(i + 1).padStart(2, '0')}.jpg`);
    await cropToRatio(frontFiles[i], 750, 1000, 750 / 1000, out);
    console.log('  [3:4]', path.basename(out));
  }

  // ---------- 800x800 每花色 4 张：正面2、侧面1、背面1（AI 扩图，左右自然延伸背景）----------
  const for800 = [
    frontFiles[0],
    frontFiles[1] || frontFiles[0],
    sideFile,
    backFile,
  ].filter(Boolean);
  for (let i = 0; i < for800.length; i++) {
    const out = path.join(dir800, `${color}_800主图_${String(i + 1).padStart(2, '0')}.jpg`);
    await expand800Ai(for800[i], out);
    console.log('  [800-AI扩图]', path.basename(out));
  }

  // ---------- 800主图_半身 每花色 4 张：正面2、侧面1、背面1（精修图截取腰部以上，800x800，纯程序）----------
  for (let i = 0; i < for800.length; i++) {
    const out = path.join(dir800, `${color}_800主图_半身_${String(i + 1).padStart(2, '0')}.jpg`);
    await cropAboveWaist(for800[i], out);
    console.log('  [800-半身]', path.basename(out));
  }

  // ---------- 800细节图：同款 1_精修图/细节图 按花色截图 800×800，输出到 4_800主图/800细节图 ----------
  try {
    const entries = await fs.readdir(detailDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const name = e.name;
      if (!name.startsWith(color + '_') || !/\.(jpg|jpeg|png|webp)$/i.test(name)) continue;
      const srcPath = path.join(detailDir, name);
      const outPath = path.join(dir800Detail, name.replace(/\.[a-z]+$/i, '.jpg'));
      await sharp(srcPath)
        .resize(800, 800, { fit: 'cover', position: 'center' })
        .jpeg({ quality: 95 })
        .toFile(outPath);
      console.log('  [800细节图]', path.basename(outPath));
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('  [800细节图]', err.message);
  }

  // ---------- 800主图_宣传图：参照 4 张，用 AI 将参考图上的模特替换为该款 精修图-全身照-正面 的模特（不带背景），其余不变，输出 800×800 ----------
  if (frontFiles[0]) {
    try {
      const refEntries = await fs.readdir(REF_XUANCHUAN_DIR, { withFileTypes: true });
      const refFiles = refEntries
        .filter((e) => e.isFile() && /\.(jpg|jpeg|png)$/i.test(e.name))
        .map((e) => e.name)
        .sort()
        .slice(0, 4);
      const modelPath = frontFiles[0];
      for (let i = 0; i < refFiles.length; i++) {
        const refPath = path.join(REF_XUANCHUAN_DIR, refFiles[i]);
        const outPath = path.join(dir800Xuanchuan, `${color}_800主图_宣传图_${String(i + 1).padStart(2, '0')}.jpg`);
        await xuanchuanSwapModel(refPath, modelPath, outPath);
        console.log('  [800主图_宣传图]', path.basename(outPath));
      }
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('  [800主图_宣传图]', err.message);
    }
  }

  // ---------- 800x1200 每花色 3 张：正面2、侧面1 ----------
  const for1200 = [frontFiles[0], frontFiles[1] || frontFiles[0], sideFile].filter(Boolean);
  for (let i = 0; i < for1200.length; i++) {
    const out = path.join(dir1200, `${color}_1200主图_${String(i + 1).padStart(2, '0')}.jpg`);
    await resize23(for1200[i], out);
    console.log('  [1200]', path.basename(out));
  }

  // ---------- 2 拼 800x800：用已生成的 半身+全身，左:右 = 4.5:3.5 ----------
  const twoPanelSpecs = [
    { halfFile: path.join(dir800, `${color}_800主图_半身_01.jpg`), fullFile: path.join(dir800, `${color}_800主图_01.jpg`) },
    { halfFile: path.join(dir800, `${color}_800主图_半身_01.jpg`), fullFile: path.join(dir800, `${color}_800主图_04.jpg`) },
    { halfFile: path.join(dir800, `${color}_800主图_半身_03.jpg`), fullFile: path.join(dir800, `${color}_800主图_01.jpg`) },
  ];
  for (let i = 0; i < twoPanelSpecs.length; i++) {
    const { halfFile, fullFile } = twoPanelSpecs[i];
    const out = path.join(dir800, `${color}_800主图_2拼_${String(i + 1).padStart(2, '0')}.jpg`);
    try {
      await fs.access(halfFile);
      await fs.access(fullFile);
    } catch {
      console.warn(`  [800-2拼] 跳过 ${path.basename(out)}：缺少 半身 或 全身 图`);
      continue;
    }
    await stitchTwoPanel(halfFile, fullFile, out);
    console.log('  [800-2拼]', path.basename(out));
  }

  // ---------- 3 拼 800x800：全身正面+全身侧面+全身背面（267+267+266=800）----------
  if (frontFiles[0] && sideFile && backFile) {
    const out = path.join(dir800, `${color}_800主图_3拼_01.jpg`);
    const widths = [267, 267, 266];
    const cellH = 800;
    const buffers = await Promise.all(
      [frontFiles[0], sideFile, backFile].map((p, i) =>
        sharp(p).resize(widths[i], cellH, { fit: 'cover' }).jpeg({ quality: 95 }).toBuffer()
      )
    );
    const composites = buffers.map((buf, i) => ({
      input: buf,
      left: widths.slice(0, i).reduce((a, b) => a + b, 0),
      top: 0,
    }));
    await sharp({
      create: { width: 800, height: cellH, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite(composites)
      .jpeg({ quality: 95 })
      .toFile(out);
    console.log('  [800-3拼]', path.basename(out));
  }

  // ---------- 1200主图 2拼 1 张：用已生成的 800主图_半身_01 + 800主图_01（正面），输出 800×1200 ----------
  const halfFile1200 = path.join(dir800, `${color}_800主图_半身_01.jpg`);
  const fullFile1200 = path.join(dir800, `${color}_800主图_01.jpg`);
  const out1200_2 = path.join(dir1200, `${color}_1200主图_2拼_01.jpg`);
  try {
    await fs.access(halfFile1200);
    await fs.access(fullFile1200);
    await stitchTwoPanel1200(halfFile1200, fullFile1200, out1200_2);
    console.log('  [1200-2拼]', path.basename(out1200_2));
  } catch {
    console.warn(`  [1200-2拼] 跳过 ${path.basename(out1200_2)}：缺少 800主图_半身_01 或 800主图_01`);
  }

  // ---------- 6_800白色透明底：每花色 1 张透明底，复制 800主图_01（正面全身）并命名为 {花色}_透明底 ----------
  const src800Front = path.join(dir800, `${color}_800主图_01.jpg`);
  const destTransparent = path.join(dir6, `${color}_透明底.jpg`);
  try {
    await fs.copyFile(src800Front, destTransparent);
    console.log('  [6_透明底]', path.basename(destTransparent));
  } catch (err) {
    console.warn(`  [6_透明底] 跳过 ${path.basename(destTransparent)}：缺少 ${path.basename(src800Front)}`);
  }
}

async function main() {
  const styleName = process.argv[2];
  const colorFilter = process.argv.slice(3);

  if (!styleName) {
    console.error('用法: node scripts/crop-from-fullbody.js <款式名> [花色...]');
    console.error('例:   node scripts/crop-from-fullbody.js 羊605');
    console.error('      node scripts/crop-from-fullbody.js 羊605 黑橙色');
    process.exit(1);
  }

  const deliveryBase = path.join(DELIVERY_DIR, styleName);
  const fullbodyDir = path.join(deliveryBase, '1_精修图', '全身照');

  try {
    await fs.access(fullbodyDir);
  } catch {
    console.error(`目录不存在: ${fullbodyDir}`);
    process.exit(1);
  }

  const byColor = await listFullbodyByColor(fullbodyDir);
  const colors = Object.keys(byColor);
  if (colors.length === 0) {
    console.error('未在全身照目录中找到符合命名规则的文件（如 黑橙色_全身_正面_4.jpg）');
    process.exit(1);
  }

  const toRun = colorFilter.length ? colors.filter((c) => colorFilter.includes(c)) : colors;
  if (colorFilter.length && toRun.length === 0) {
    console.error('未匹配到指定花色，可选:', colors.join(', '));
    process.exit(1);
  }

  const baseOutDir = deliveryBase;
  console.log(`款式: ${styleName}，花色: ${toRun.join(', ')}`);
  console.log('输出目录:', baseOutDir);

  for (const color of toRun) {
    console.log(`\n--- ${color} ---`);
    await runForColor(color, byColor[color], baseOutDir);
  }

  console.log('\n全部完成（800主图单人 AI 扩图，800主图半身 程序截取，其余程序裁剪/拼接）');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
