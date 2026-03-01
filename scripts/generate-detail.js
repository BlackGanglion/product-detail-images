
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { generateImage } from '../src/api/nanoBanana.js';
import { clothingDetailPrompt } from '../src/prompts/clothingDetailTemplates.js';
import config from '../config/default.js';

// 不依赖 sharp 的读图尺寸（避免脚本启动时加载 sharp）
async function getImageSize(filePath) {
  const buf = await fs.readFile(filePath);
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0xff && u8[1] === 0xd8) {
    // 扫描前 256KB 查找所有 SOF，取主图（尺寸最大者，排除 EXIF 缩略图）
    const limit = Math.min(u8.length - 9, 256 * 1024);
    let best = null;
    for (let i = 2; i < limit; i++) {
      if (u8[i] === 0xff && (u8[i + 1] === 0xc0 || u8[i + 1] === 0xc1 || u8[i + 1] === 0xc2)) {
        const w = (u8[i + 7] << 8) | u8[i + 8];
        const h = (u8[i + 5] << 8) | u8[i + 6];
        if (!best || w * h > best.w * best.h) best = { w, h };
      }
    }
    if (best) return { width: best.w, height: best.h };
  }
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    return {
      width: (u8[16] << 24) | (u8[17] << 16) | (u8[18] << 8) | u8[19],
      height: (u8[20] << 24) | (u8[21] << 16) | (u8[22] << 8) | u8[23],
    };
  }
  throw new Error('Unsupported image format for getImageSize');
}

async function fileToBase64(filePath) {
  const buf = await fs.readFile(filePath);
  return buf.toString('base64');
}
function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext] || 'image/jpeg';
}
async function saveBase64Image(base64Data, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, Buffer.from(base64Data, 'base64'));
  return outputPath;
}

// ── 配置 ──────────────────────────────────────────────
const ROOT = process.cwd();
// 羊60x款用 细节图-上衣版，其他用 细节图-主花色
function getRefDetailDir(styleName) {
  const subdir = styleName.startsWith('羊') ? '细节图-上衣版' : '细节图-主花色';
  return path.join(ROOT, '参考/1_精修图', subdir);
}
const SHIPAI_DIR = path.join(ROOT, '实拍');
const DELIVERY_DIR = path.join(ROOT, '交付');
const CONCURRENCY = config.generation.concurrency || 3;

// ── 参考细节图列表 ────────────────────────────────────
const DETAIL_TYPES = [
  { file: '领口.JPG', type: '领口' },
  { file: '下摆.JPG', type: '下摆' },
  { file: '侧边.JPG', type: '侧边' },
  { file: '内衬.JPG', type: '内衬' },
  { file: '肩胛.JPG', type: '肩胛' },
  { file: '袖口.JPG', type: '袖口' },
];

// ── 实拍图分类 → 细节类型匹配映射 ─────────────────────
// 每个细节类型对应的实拍图分类关键词（优先级从高到低）
const SHIPAI_MATCH_MAP = {
  '领口': ['领口特写', '领口'],
  '下摆': ['下摆特写', '下摆', '前襟下摆', '侧下特写'],
  '侧边': ['侧面'],
  '内衬': ['内衬', '敞开内衬', '正面展开', '正面敞开'],
  '肩胛': ['肩部特写', '细节特写', '肩'],
  '袖口': ['袖口特写', '袖口', '前襟特写'],
};

// Fallback：从已生成的全身照目录中取
const FALLBACK_MAP = {
  '领口': '正面',
  '下摆': '正面',
  '侧边': '侧面',
  '内衬': '敞开',
  '肩胛': '正面',
  '袖口': '正面',
};

// ── 从全身照截取的细节类型：领口/下摆/袖口用正面照，侧边/肩胛用侧面照，参考图只提供版型和姿势 ──
const CROP_FROM_FULLBODY_TYPES = ['领口', '下摆', '袖口', '侧边', '肩胛'];

// ── 细节类型焦点描述（用于 prompt additionalNotes）──────
const DETAIL_FOCUS = {
  '领口': 'This is a NECKLINE/COLLAR close-up shot. Focus on the collar area — the collar shape, neckline cut, collar stitching, any collar decorations, buttons near the neckline.',
  '下摆': 'This is a HEMLINE close-up shot. Focus on the bottom hem area — the hemline shape (straight/scalloped/curved), hem stitching, any piping or trim along the bottom edge.',
  '侧边': 'This is a SIDE VIEW detail shot. Focus on the side profile of the garment — how it drapes from the side, the side seam, armhole edge, and overall silhouette from the side angle.',
  '内衬': `This is an INNER LINING detail shot — a FLAT-LAY studio photo of a garment spread open to reveal its inner lining.

## YOUR TASK — STEP BY STEP:
1. LOOK at Image 1 (the reference flat-lay photo). This is your COMPOSITION BLUEPRINT. Memorize every detail: the garment's position, how it's spread, the background surface, the camera angle, the lighting, the shadows.
2. LOOK at the clothing reference photo ONLY to identify: (a) the outer fabric pattern/color/texture, and (b) the inner lining color/material.
3. GENERATE an image that is a PIXEL-PERFECT copy of Image 1's composition, with ONLY the fabric pattern/color and lining color swapped.

## ABSOLUTE RULES:
- The output MUST look like a FLAT-LAY STUDIO PHOTO — garment laid flat on a surface, NO person, NO model, NO human body parts visible
- The garment's shape, position, spread angle, and how it's opened MUST match Image 1 EXACTLY
- The background surface, lighting, and shadows MUST match Image 1 EXACTLY
- If the clothing reference shows a person wearing the garment — COMPLETELY DISREGARD the person, their pose, the background, and how the garment hangs on them. ONLY extract the fabric appearance and lining color.

## WHAT TO EXTRACT FROM CLOTHING REFERENCE:
1. OUTER FABRIC: pattern, color, texture, weave, decorative elements
2. INNER LINING: color, texture, sheen (usually solid-color satin/silk)
That is ALL. Nothing else from the clothing reference should appear in your output.`,
  '肩胛': 'This is a SHOULDER area close-up shot. Focus on the shoulder construction — the shoulder seam, sleeve attachment area, the upper back/shoulder blade area, any decorative details on the shoulder.',
  '袖口': 'This is a SLEEVE/CUFF close-up shot. Focus on the sleeve end and cuff area — the cuff shape, sleeve hem, any buttons or closures at the cuff, the sleeve width and drape.',
};

// 参考图（细节图-上衣版）只提供版型+姿势；服装从精修图-全身照截取对应位置
const DETAIL_CROP_INSTRUCTION = {
  '领口': 'Image 1 (reference) defines ONLY the garment CUT (版型) and POSE (姿势). Replace the garment with the corresponding region CROPPED from Image 2. Image 2 = full-body FRONT photo (全身照正面). CROP the NECKLINE/COLLAR region from Image 2. Output: same pose/framing as Image 1, garment from Image 2 collar area. Fabric/pattern must be IDENTICAL to Image 2.',
  '下摆': 'Image 1 defines ONLY 版型 and 姿势. Image 2 = full-body FRONT photo. CROP the WAIST/HEM region (腰部与下摆) from Image 2. Output: Image 1 pose + waist/hem area from Image 2. Fabric must match Image 2 exactly.',
  '袖口': 'Image 1 defines ONLY 版型 and 姿势. Image 2 = full-body FRONT photo (arms visible). CROP the SLEEVE/CUFF area from Image 2. Output: Image 1 pose + cuff from Image 2. Cuff color/pattern must match Image 2 exactly.',
  '侧边': 'Image 1 (参考 细节图-上衣版) defines ONLY 版型 and 姿势. Images 2–4 are three full-body photos: SIDE (侧面_2), FRONT (正面_4), BACK (背面_7). REPLACE the garment pattern/花纹 with the fabric from these three photos. The output pattern/花纹 MUST match this garment; use the side view (Image 2) as main reference and combine with front/back for consistency. Output: Image 1 pose + garment pattern from Images 2–4. Do NOT keep any pattern from Image 1.',
  '肩胛': 'Image 1 defines ONLY 版型 and 姿势. Image 2 = full-body SIDE photo (全身侧面照). CROP the SHOULDER/BLADE region from Image 2. Output: Image 1 pose + shoulder area from Image 2.',
};

// ── 款式类型判断 ──────────────────────────────────────
function isSweater(styleName) {
  return styleName.startsWith('羊');
}

// ── 目录适配（可能不含"款"）──────────────────────────
async function resolveDir(baseDir, styleName) {
  const direct = path.join(baseDir, styleName);
  try { await fs.access(direct); return direct; } catch {}
  const stripped = path.join(baseDir, styleName.replace(/款$/, ''));
  try { await fs.access(stripped); return stripped; } catch {}
  return direct;
}

// ── 实拍图文件扩展名自适应 ────────────────────────────
async function resolveShipaiPhoto(dir, fileName) {
  for (const ext of ['.JPG', '.jpg', '.jpeg', '.png']) {
    const p = path.join(dir, `${fileName}${ext}`);
    try { await fs.access(p); return p; } catch {}
  }
  return path.join(dir, `${fileName}.JPG`);
}

// ── 从实拍图分类中按关键词匹配照片（最多 maxCount 张）──
function matchShipaiPhotos(shipaiClassify, keywords, maxCount = 3) {
  const results = [];
  for (const keyword of keywords) {
    for (const [category, photos] of Object.entries(shipaiClassify)) {
      if (category.includes(keyword)) {
        for (const photo of photos) {
          if (!results.includes(photo)) {
            results.push(photo);
          }
          if (results.length >= maxCount) return results;
        }
      }
    }
    if (results.length >= maxCount) return results;
  }
  return results;
}

// ── 获取全身照 fallback ──────────────────────────────
async function getFallbackPhotos(deliveryDir, color, fallbackType, maxCount = 3) {
  const fullbodyDir = path.join(deliveryDir, '1_精修图/全身照');
  try {
    const files = await fs.readdir(fullbodyDir);
    const keyword = FALLBACK_MAP[fallbackType] || '正面';
    const matched = files
      .filter(f => f.startsWith(`${color}_`) && f.includes(keyword) && /\.(jpg|jpeg|png)$/i.test(f))
      .sort()
      .slice(0, maxCount)
      .map(f => path.join(fullbodyDir, f));
    return matched;
  } catch {
    return [];
  }
}

// ── 细节图「从全身照截取」专用：按细节类型取正面照、侧面照或手臂展开照 ─────
// 领口 优先 全身_正面_5（花纹更清晰）；下摆 用正面照；袖口 优先手臂展开；侧边 用侧面照
const FULLBODY_CROP_PRIORITY_COLLAR = ['全身_正面_5', '全身_正面_4', '全身_正面_6', '全身_正面_1'];
const FULLBODY_CROP_PRIORITY_FRONT = ['全身_正面_4', '全身_正面_5', '全身_正面_6', '全身_正面_1'];
const FULLBODY_CROP_PRIORITY_CUFF = ['全身_敞开_3', '全身_正面_4', '全身_正面_5', '全身_正面_6', '全身_正面_1']; // 袖口：优先手臂展开
const FULLBODY_CROP_PRIORITY_SIDE = ['全身_侧面_2', '全身_侧面_1'];
// 侧边专用：取 侧面_2、正面_4、背面_7 三张全身照作为花纹来源
const SIDE_SOURCE_SUFFIXES = ['全身_侧面_2', '全身_正面_4', '全身_背面_7'];
async function getFullbodyCropSourcesForSide(deliveryDir, color) {
  const fullbodyDir = path.join(deliveryDir, '1_精修图/全身照');
  try {
    const files = await fs.readdir(fullbodyDir);
    const paths = [];
    for (const suffix of SIDE_SOURCE_SUFFIXES) {
      const name = `${color}_${suffix}`;
      const found = files.find(f => f.startsWith(name) && /\.(jpg|jpeg|png)$/i.test(f));
      if (found) paths.push(path.join(fullbodyDir, found));
    }
    return paths.length === 3 ? paths : null;
  } catch {}
  return null;
}
async function getFullbodyCropSource(deliveryDir, color, detailType) {
  const fullbodyDir = path.join(deliveryDir, '1_精修图/全身照');
  let priority = FULLBODY_CROP_PRIORITY_FRONT;
  if (detailType === '领口') priority = FULLBODY_CROP_PRIORITY_COLLAR;
  else if (detailType === '侧边' || detailType === '肩胛') priority = FULLBODY_CROP_PRIORITY_SIDE;
  else if (detailType === '袖口') priority = FULLBODY_CROP_PRIORITY_CUFF;
  try {
    const files = await fs.readdir(fullbodyDir);
    for (const suffix of priority) {
      const name = `${color}_${suffix}`;
      const found = files.find(f => f.startsWith(name) && /\.(jpg|jpeg|png)$/i.test(f));
      if (found) return path.join(fullbodyDir, found);
    }
  } catch {}
  return null;
}

// ── 交互式询问主花色 ─────────────────────────────────
async function askMainColors(colors, mainColor) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (q) => new Promise(resolve => rl.question(q, resolve));

  console.log(`\n可用花色: ${colors.map((c, i) => `${i + 1}. ${c}`).join('  ')} (主花色: ${mainColor})`);
  const answer = await question('请输入主花色序号（多个用逗号分隔，回车=仅主花色）: ');
  rl.close();

  if (!answer.trim()) return colors.includes(mainColor) ? [mainColor] : [colors[0]];

  const indices = answer.split(/[,，\s]+/).map(s => parseInt(s.trim(), 10) - 1);
  const selected = indices.filter(i => i >= 0 && i < colors.length).map(i => colors[i]);
  if (selected.length === 0) {
    console.error('未选择有效花色，退出');
    process.exit(1);
  }
  return selected;
}

// ── 并发控制 ────────────────────────────────────────
async function runConcurrent(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;
  let succeeded = 0;
  let failed = 0;

  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      const task = tasks[idx];
      try {
        results[idx] = await task();
        succeeded++;
      } catch (err) {
        results[idx] = null;
        failed++;
        console.error(`  ✗ 失败: ${err.message}`);
      }
      console.log(`  进度: ${succeeded + failed}/${tasks.length} (成功 ${succeeded}, 失败 ${failed})`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}

// ── 单张生成 ────────────────────────────────────────
async function generateOne({ refPhotoPath, shipaiPhotoPaths, promptText, outputPath, label, aspectRatio, targetWidth, targetHeight }) {
  console.log(`  [开始] ${label}`);

  // 准备图片：参考图 + 实拍图（1~3 张）
  const images = [];

  const refBase64 = await fileToBase64(refPhotoPath);
  images.push({ mimeType: mimeType(refPhotoPath), base64: refBase64 });

  for (const sp of shipaiPhotoPaths) {
    const b64 = await fileToBase64(sp);
    images.push({ mimeType: mimeType(sp), base64: b64 });
  }

  const imageData = await generateImage(promptText, images, { aspectRatio });

  await saveBase64Image(imageData, outputPath);

  // resize 到参考图精确尺寸（sharp 不可用时跳过）
  try {
    const sharp = (await import('sharp')).default;
    await sharp(outputPath)
      .resize(targetWidth, targetHeight, { fit: 'fill' })
      .jpeg({ quality: 95 })
      .toFile(outputPath + '.tmp');
    await fs.rename(outputPath + '.tmp', outputPath);
    console.log(`  [完成] ${label} → ${path.basename(outputPath)} (${targetWidth}x${targetHeight})`);
  } catch (err) {
    console.log(`  [完成] ${label} → ${path.basename(outputPath)} (未 resize: ${err.message})`);
  }
  return outputPath;
}

// ── 收集所有任务 ────────────────────────────────────
async function collectTasks({ styleName, selectedColors, matching, prompts }) {
  const sweater = isSweater(styleName);
  const tasks = [];

  const shipaiDir = await resolveDir(SHIPAI_DIR, styleName);
  const deliveryBase = await resolveDir(DELIVERY_DIR, styleName);
  const outputDir = path.join(deliveryBase, '1_精修图/细节图');

  if (sweater) {
    console.log(`  类型: 针织衫 (跳过内衬)`);
  } else {
    console.log(`  类型: 马甲`);
  }

  for (const color of selectedColors) {
    const colorData = matching[styleName].花色[color];
    if (!colorData) {
      console.warn(`  ⚠ 未找到花色数据: ${color}，跳过`);
      continue;
    }

    const shipaiClassify = colorData.实拍图分类;
    const colorPrompt = prompts[styleName]?.[color];
    if (!colorPrompt) {
      console.warn(`  ⚠ 未找到 ${color} 的 prompt，跳过`);
      continue;
    }

    for (const detail of DETAIL_TYPES) {
      // 针织衫跳过内衬
      if (sweater && detail.type === '内衬') continue;

      const refDetailDir = getRefDetailDir(styleName);
      // 细节图-上衣版 命名为 黑橙色_领口.jpg 等，细节图-主花色 命名为 领口.JPG 等
      const refPhotoPath = sweater
        ? path.join(refDetailDir, `黑橙色_${detail.type}.jpg`)
        : path.join(refDetailDir, detail.file);

      // 读取参考图尺寸，决定 aspectRatio
      let targetWidth, targetHeight, aspectRatio;
      try {
        const size = await getImageSize(refPhotoPath);
        targetWidth = size.width;
        targetHeight = size.height;
        aspectRatio = targetWidth > targetHeight ? '3:2' : '2:3';
      } catch (err) {
        console.warn(`  ⚠ 无法读取参考图: ${detail.file}，跳过 (${err.message})`);
        continue;
      }

      let shipaiPhotoPaths = [];
      let additionalNotes;

      if (CROP_FROM_FULLBODY_TYPES.includes(detail.type)) {
        // 侧边：优先用 侧面_2+正面_4+背面_7 三张；其他类型单张全身照
        if (detail.type === '侧边') {
          const sidePaths = await getFullbodyCropSourcesForSide(deliveryBase, color);
          if (sidePaths) shipaiPhotoPaths = sidePaths;
        }
        if (shipaiPhotoPaths.length === 0) {
          const fullbodyPath = await getFullbodyCropSource(deliveryBase, color, detail.type);
          if (!fullbodyPath) {
            const hint = detail.type === '侧边' ? '全身_侧面_2/正面_4/背面_7' : '全身_正面_4';
            console.warn(`  ⚠ ${color}/${detail.type}: 未找到全身照（如 ${hint}），跳过`);
            continue;
          }
          shipaiPhotoPaths = [fullbodyPath];
        }
        const cropInstruction = DETAIL_CROP_INSTRUCTION[detail.type];
        additionalNotes = `TASK: Reference (Image 1, 细节图-上衣版) provides ONLY 版型(cut) and 姿势(pose). Replace the garment with the corresponding region / 花纹 from the full-body photo(s). ${cropInstruction}\n\nImage 1 = pose/framing template only. Output dimensions must match Image 1.`;
      } else {
        // 其他细节类型：匹配实拍图（内衬只取 1 张）
        const keywords = SHIPAI_MATCH_MAP[detail.type] || [];
        const maxPhotos = detail.type === '内衬' ? 1 : 3;
        let shipaiPhotos = matchShipaiPhotos(shipaiClassify, keywords, maxPhotos);

        for (const photo of shipaiPhotos) {
          const p = await resolveShipaiPhoto(shipaiDir, photo);
          try {
            await fs.access(p);
            shipaiPhotoPaths.push(p);
          } catch {}
        }

        if (shipaiPhotoPaths.length === 0) {
          const fallbacks = await getFallbackPhotos(deliveryBase, color, detail.type, 3);
          if (fallbacks.length > 0) {
            shipaiPhotoPaths = fallbacks;
            console.log(`    ${color}/${detail.type}: 无匹配实拍，使用全身照 fallback (${fallbacks.length} 张)`);
          } else {
            console.warn(`  ⚠ ${color}/${detail.type}: 无实拍图也无全身照 fallback，跳过`);
            continue;
          }
        }

        const detailFocus = DETAIL_FOCUS[detail.type];
        const fabricDesc = colorData.描述;
        if (detail.type === '内衬') {
          additionalNotes = `${detailFocus}\n\nREMINDER — DO NOT reproduce the clothing reference photo's composition. The clothing reference photo shows a real person wearing the garment — treat it as a COLOR SWATCH ONLY. Extract the fabric pattern/color and lining color, then DISCARD everything else from that photo.\n\nYour output is a FLAT-LAY STUDIO PHOTO matching Image 1's layout exactly. Target garment: ${fabricDesc}`;
        } else {
          additionalNotes = `${detailFocus}\n\nIMPORTANT: The reference photo (Image 1) defines the EXACT garment structure — neckline shape, collar style, hemline style, sleeve style, closures position, etc. Do NOT change any structural element. Only replace the FABRIC PATTERN AND COLOR using the clothing reference photo(s).\n\nTarget fabric/color description: ${fabricDesc}`;
        }
      }

      const promptText = clothingDetailPrompt({
        additionalNotes,
        clothingCount: shipaiPhotoPaths.length,
      });

      const outputFileName = `${color}_${detail.type}.jpg`;
      const outputPath = path.join(outputDir, outputFileName);
      const label = CROP_FROM_FULLBODY_TYPES.includes(detail.type)
        ? `${color}/${detail.type} ← 全身照截取`
        : `${color}/${detail.type} ← ${shipaiPhotoPaths.length} 张实拍`;

      tasks.push({
        color,
        detailType: detail.type,
        refPhotoPath,
        shipaiPhotoPaths,
        promptText,
        outputPath,
        label,
        aspectRatio,
        targetWidth,
        targetHeight,
      });
    }
  }

  return { tasks, outputDir };
}

// ── 主入口 ──────────────────────────────────────────
async function main() {
  const styleName = process.argv[2];
  const filters = process.argv.slice(3);
  if (!styleName) {
    console.error('用法: node scripts/generate-detail.js <款式名> [过滤条件...]');
    console.error('例如: node scripts/generate-detail.js 马甲2599款');
    console.error('      node scripts/generate-detail.js 马甲2599款 领口');
    console.error('      node scripts/generate-detail.js 马甲2599款 红色');
    console.error('      node scripts/generate-detail.js 马甲2599款 红色 领口');
    process.exit(1);
  }

  // 加载配置
  const matching = JSON.parse(await fs.readFile(path.join(ROOT, '全身照匹配.json'), 'utf-8'));
  const prompts = JSON.parse(await fs.readFile(path.join(ROOT, '全身照prompts.json'), 'utf-8'));

  if (!matching[styleName]) {
    console.error(`未找到款式: ${styleName}`);
    process.exit(1);
  }
  if (!prompts[styleName]) {
    console.error(`未找到 prompt: ${styleName}`);
    process.exit(1);
  }

  // 列出所有花色
  const allColors = Object.keys(matching[styleName].花色);
  const mainColor = matching[styleName].主花色 || allColors[0]; // 主花色：配置优先，否则取第一个

  // 检查过滤条件中是否已包含花色名
  const colorFilters = filters.filter(f => allColors.includes(f));
  const otherFilters = filters.filter(f => !allColors.includes(f));

  let selectedColors;
  if (colorFilters.length > 0) {
    selectedColors = colorFilters;
  } else {
    selectedColors = await askMainColors(allColors, mainColor);
  }

  console.log(`\n款式: ${styleName}`);
  console.log(`选中花色: ${selectedColors.join(', ')}`);

  // 收集任务
  const { tasks: allTasks, outputDir } = await collectTasks({ styleName, selectedColors, matching, prompts });

  // 应用其他过滤条件（非花色过滤，例如 "领口"、"下摆"）
  let tasks = allTasks;
  const includes = otherFilters.filter(f => !f.startsWith('^'));
  const excludes = otherFilters.filter(f => f.startsWith('^')).map(f => f.slice(1));
  if (includes.length > 0 || excludes.length > 0) {
    tasks = tasks.filter(t =>
      includes.every(f => t.label.includes(f) || t.detailType.includes(f)) &&
      excludes.every(f => !t.label.includes(f) && !t.detailType.includes(f))
    );
    const parts = [];
    if (includes.length) parts.push(`包含: ${includes.map(f => `"${f}"`).join(' + ')}`);
    if (excludes.length) parts.push(`排除: ${excludes.map(f => `"${f}"`).join(', ')}`);
    console.log(`过滤: ${parts.join(' | ')}`);
  }

  if (tasks.length === 0) {
    console.log('\n无任务可执行，退出');
    process.exit(0);
  }

  console.log(`总任务: ${tasks.length} 张, 并发: ${CONCURRENCY}\n`);

  // 确保输出目录存在
  await fs.mkdir(outputDir, { recursive: true });

  const startTime = Date.now();

  const results = await runConcurrent(
    tasks.map(t => () => generateOne(t)),
    CONCURRENCY,
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const success = results.filter(Boolean).length;

  // 按花色统计
  for (const color of selectedColors) {
    const colorTasks = tasks.filter(t => t.color === color);
    const colorResults = colorTasks.map(t => results[tasks.indexOf(t)]);
    const colorSuccess = colorResults.filter(Boolean).length;
    console.log(`  ${color}: ${colorSuccess}/${colorTasks.length} 张`);
  }

  console.log(`\n全部完成! ${success}/${tasks.length} 张, 耗时 ${elapsed}s`);
  console.log(`输出目录: ${outputDir}`);
}

main().catch(err => {
  console.error('执行失败:', err);
  process.exit(1);
});
