#!/usr/bin/env node
/**
 * 测试：800主图用 letterbox 方式保留全图（左右用边缘色填充，视觉上像整图）
 * 生成一张 黑橙色_800主图_01.jpg
 */
import path from 'path';
import sharp from 'sharp';

const ROOT = process.cwd();
const inputPath = path.join(ROOT, '交付/羊605/1_精修图/全身照/黑橙色_全身_正面_4.jpg');
const outputPath = path.join(ROOT, '交付/羊605/4_800主图(天猫、C店、京东、拼多多)/黑橙色_800主图_01.jpg');

/** 从图片左右边缘采样平均色 */
async function getEdgeColor(imageBuffer, width, height, sampleW = 40) {
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

async function main() {
  // 1. 等比缩放到 533x800（全图放入 800 高度，宽度按比例）
  const resized = await sharp(inputPath)
    .resize(533, 800, { fit: 'inside' })
    .jpeg({ quality: 95 })
    .toBuffer();

  const imgW = 533;
  const imgH = 800;

  // 2. 从缩放后图片左右边缘采样平均色
  const bg = await getEdgeColor(resized, imgW, imgH);

  // 3. 居中 composit 到 800x800 画布，左右用边缘色填充
  const left = Math.floor((800 - imgW) / 2);
  await sharp({
    create: {
      width: 800,
      height: 800,
      channels: 3,
      background: bg,
    },
  })
    .composite([{ input: resized, left, top: 0 }])
    .jpeg({ quality: 95 })
    .toFile(outputPath);

  console.log('已生成:', outputPath);
  console.log('全图保留，左右填充边缘色 rgb(%d,%d,%d)', bg.r, bg.g, bg.b);
}

main().catch(console.error);
