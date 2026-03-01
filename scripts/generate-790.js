import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { fileToBase64, getImageSize, mimeType, saveBase64Image } from '../src/utils/image.js';
import { generateImage } from '../src/api/nanoBanana.js';
import config from '../config/default.js';

// ── 配置 ──────────────────────────────────────────────
const ROOT = process.cwd();
const REF_DIR = path.join(ROOT, '参考/7_790（天猫）');
const DELIVERY_DIR = path.join(ROOT, '交付');
const CONCURRENCY = config.generation.concurrency || 3;

// ── 19 张详情页 Section 映射 ──────────────────────────
// materials: color='color1'|'color2', source='fullbody'|'detail', file=文件名(不含颜色前缀)
const SECTION_MAP = [
  {
    index: 1, type: 'fullbody_single',
    materials: [{ color: 'color1', source: 'fullbody', file: '全身_正面_1' }],
  },
  {
    index: 2, type: 'fullbody_single',
    materials: [{ color: 'color2', source: 'fullbody', file: '全身_正面_4' }],
  },
  {
    index: 3, type: 'fullbody_single',
    materials: [{ color: 'color2', source: 'fullbody', file: '全身_正面_5' }],
  },
  {
    index: 4, type: 'detail_single',
    materials: [{ color: 'color1', source: 'detail', file: '内衬' }],
  },
  {
    index: 5, type: 'detail_multi',
    materials: [
      { color: 'color1', source: 'detail', file: '领口' },
      { color: 'color1', source: 'detail', file: '袖口' },
    ],
  },
  {
    index: 6, type: 'info_chart',
    materials: [{ color: 'color2', source: 'fullbody', file: '全身_正面_1' }],
  },
  {
    index: 7, type: 'fullbody_multi',
    materials: [
      { color: 'color1', source: 'fullbody', file: '全身_正面_1' },
      { color: 'color2', source: 'fullbody', file: '全身_正面_1' },
    ],
  },
  {
    index: 8, type: 'fullbody_single',
    materials: [{ color: 'color1', source: 'fullbody', file: '全身_正面_5' }],
  },
  {
    index: 9, type: 'fullbody_multi',
    materials: [
      { color: 'color1', source: 'fullbody', file: '全身_正面_4' },
      { color: 'color1', source: 'fullbody', file: '全身_背面_7' },
    ],
  },
  {
    index: 10, type: 'fullbody_single',
    materials: [{ color: 'color1', source: 'fullbody', file: '全身_敞开_3' }],
  },
  {
    index: 11, type: 'fullbody_single',
    materials: [{ color: 'color1', source: 'fullbody', file: '全身_正面_1' }],
  },
  {
    index: 12, type: 'fullbody_single',
    materials: [{ color: 'color2', source: 'fullbody', file: '全身_侧面_2' }],
  },
  {
    index: 13, type: 'fullbody_multi',
    materials: [
      { color: 'color2', source: 'fullbody', file: '全身_正面_4' },
      { color: 'color2', source: 'fullbody', file: '全身_背面_7' },
    ],
  },
  {
    index: 14, type: 'fullbody_single',
    materials: [{ color: 'color2', source: 'fullbody', file: '全身_敞开_3' }],
  },
  {
    index: 15, type: 'fullbody_single',
    materials: [{ color: 'color2', source: 'fullbody', file: '全身_正面_5' }],
  },
  {
    index: 16, type: 'detail_single',
    materials: [{ color: 'color1', source: 'detail', file: '领口' }],
  },
  {
    index: 17, type: 'detail_single',
    materials: [{ color: 'color1', source: 'detail', file: '袖口' }],
  },
  {
    index: 18, type: 'detail_single',
    materials: [{ color: 'color1', source: 'detail', file: '下摆' }],
  },
  {
    index: 19, type: 'detail_single',
    materials: [{ color: 'color1', source: 'detail', file: '侧边' }],
  },
];

// ── 按 section type 生成 prompt ──────────────────────
function buildPrompt(section, materialPaths) {
  const imageCount = 1 + materialPaths.length; // 参考图 + 素材图
  const imageList = materialPaths
    .map((p, i) => `${i + 2}. ${path.basename(p)}`)
    .join('\n');

  const base = `You are a professional e-commerce product detail page designer.

I am providing ${imageCount} images:
1. A detail page reference image — this is the LAYOUT TEMPLATE. You MUST keep the EXACT same layout, text placement, decorative elements, background pattern, and overall page design.
${imageList}

Generate a product detail page image where:
- The OUTPUT IMAGE must have the EXACT SAME dimensions as the reference image (image 1)
- The page layout, text, decorative elements, borders, and background are IDENTICAL to the reference
- ONLY replace the product photo(s) in the layout with the provided material photo(s)
- The replaced photos should fit naturally into the designated photo areas in the layout
- Maintain consistent lighting and color harmony with the page design
- ALL Chinese text, logos, size charts, and graphic elements must be preserved EXACTLY as they appear in the reference
- The result should look like a professionally designed product detail page`;

  switch (section.type) {
    case 'fullbody_single':
      return `${base}

SPECIFIC INSTRUCTION: Replace the single model/product photo in the reference with the provided full-body photo (image 2). Keep the model's pose visible and properly framed within the layout area. Preserve all surrounding design elements exactly.`;

    case 'fullbody_multi':
      return `${base}

SPECIFIC INSTRUCTION: Replace the model/product photos in the reference with the ${materialPaths.length} provided photos (images 2-${imageCount}). Each photo should replace its corresponding position in the layout. Maintain proper sizing and alignment within each photo area.`;

    case 'detail_single':
      return `${base}

SPECIFIC INSTRUCTION: Replace the detail/close-up photo in the reference with the provided detail photo (image 2). This is a close-up/detail shot — ensure the fabric texture, stitching, and material details are clearly visible within the layout area.`;

    case 'detail_multi':
      return `${base}

SPECIFIC INSTRUCTION: Replace the detail photos in the reference with the ${materialPaths.length} provided detail photos (images 2-${imageCount}). Each detail photo should replace its corresponding position in the layout. Ensure fabric details and textures are clearly visible.`;

    case 'info_chart':
      return `${base}

SPECIFIC INSTRUCTION: This page contains product information, a size chart, and/or specification details alongside a product photo. Replace ONLY the product photo with the provided photo (image 2). ALL text content, size charts, tables, specifications, and informational elements MUST be preserved EXACTLY as they appear — do NOT modify any text or data.`;

    default:
      return base;
  }
}

// ── 目录适配（可能不含"款"）─────────────────────────
async function resolveDir(baseDir, styleName) {
  const direct = path.join(baseDir, styleName);
  try { await fs.access(direct); return direct; } catch {}
  const stripped = path.join(baseDir, styleName.replace(/款$/, ''));
  try { await fs.access(stripped); return stripped; } catch {}
  return direct;
}

// ── 图片文件扩展名自适应 ────────────────────────────
async function resolveImageFile(dir, fileName) {
  for (const ext of ['.jpg', '.JPG', '.jpeg', '.png']) {
    const p = path.join(dir, `${fileName}${ext}`);
    try { await fs.access(p); return p; } catch {}
  }
  return null;
}

// ── aspectRatio 选择 ─────────────────────────────────
function chooseAspectRatio(width, height) {
  const ratio = width / height;
  if (ratio > 1.2) return '3:2';
  if (ratio < 0.8) return '2:3';
  return '1:1';
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

// ── 解析 CLI 参数 ───────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('用法: node scripts/generate-790.js <款式名> --color1=<主色> --color2=<副色> [编号...]');
    console.error('');
    console.error('例如:');
    console.error('  node scripts/generate-790.js 马甲2599款 --color1=红色 --color2=金色');
    console.error('  node scripts/generate-790.js 马甲2599款 --color1=红色 --color2=金色 7 9');
    console.error('  node scripts/generate-790.js 马甲2599款 --color1=红色 --color2=金色 ^6');
    process.exit(1);
  }

  const styleName = args[0];
  let color1 = null;
  let color2 = null;
  const includes = [];
  const excludes = [];

  for (const arg of args.slice(1)) {
    if (arg.startsWith('--color1=')) {
      color1 = arg.slice('--color1='.length);
    } else if (arg.startsWith('--color2=')) {
      color2 = arg.slice('--color2='.length);
    } else if (arg.startsWith('^')) {
      excludes.push(parseInt(arg.slice(1), 10));
    } else if (/^\d+$/.test(arg)) {
      includes.push(parseInt(arg, 10));
    }
  }

  if (!color1 || !color2) {
    console.error('错误: 必须指定 --color1 和 --color2');
    process.exit(1);
  }

  return { styleName, color1, color2, includes, excludes };
}

// ── 解析素材文件路径 ─────────────────────────────────
async function resolveMaterials(section, deliveryBase, colorMap) {
  const paths = [];
  const missing = [];

  for (const mat of section.materials) {
    const color = colorMap[mat.color];
    let filePath = null;

    if (mat.source === 'fullbody') {
      const dir = path.join(deliveryBase, '1_精修图/全身照');
      filePath = await resolveImageFile(dir, `${color}_${mat.file}`);
    } else if (mat.source === 'detail') {
      const dir = path.join(deliveryBase, '1_精修图/细节图');
      filePath = await resolveImageFile(dir, `${color}_${mat.file}`);
    }

    if (filePath) {
      paths.push(filePath);
    } else {
      missing.push(`${color}_${mat.file}`);
    }
  }

  return { paths, missing };
}

// ── 单张生成 ────────────────────────────────────────
async function generateOne({ refPath, materialPaths, promptText, outputPath, label, targetWidth, targetHeight, aspectRatio }) {
  console.log(`  [开始] ${label}`);

  // 准备图片: 参考图 + 素材图
  const images = [];

  const refBase64 = await fileToBase64(refPath);
  images.push({ mimeType: mimeType(refPath), base64: refBase64 });

  for (const mp of materialPaths) {
    const b64 = await fileToBase64(mp);
    images.push({ mimeType: mimeType(mp), base64: b64 });
  }

  const imageData = await generateImage(promptText, images, { aspectRatio });

  await saveBase64Image(imageData, outputPath);

  // resize 到参考图精确尺寸
  await sharp(outputPath)
    .resize(targetWidth, targetHeight, { fit: 'fill' })
    .jpeg({ quality: 95 })
    .toFile(outputPath + '.tmp');
  await fs.rename(outputPath + '.tmp', outputPath);

  console.log(`  [完成] ${label} → ${path.basename(outputPath)} (${targetWidth}x${targetHeight})`);
  return outputPath;
}

// ── 主入口 ──────────────────────────────────────────
async function main() {
  const { styleName, color1, color2, includes, excludes } = parseArgs();
  const colorMap = { color1, color2 };

  // 验证交付目录
  const deliveryBase = await resolveDir(DELIVERY_DIR, styleName);
  try {
    await fs.access(deliveryBase);
  } catch {
    console.error(`未找到交付目录: ${deliveryBase}`);
    process.exit(1);
  }

  // 过滤 sections
  let sections = [...SECTION_MAP];
  if (includes.length > 0) {
    sections = sections.filter(s => includes.includes(s.index));
  }
  if (excludes.length > 0) {
    sections = sections.filter(s => !excludes.includes(s.index));
  }

  // 收集任务
  const tasks = [];
  const skipped = [];

  for (const section of sections) {
    const refFileName = `790详情页_${section.index}.jpg`;
    const refPath = path.join(REF_DIR, refFileName);

    // 读取参考图尺寸
    let targetWidth, targetHeight;
    try {
      const size = await getImageSize(refPath);
      targetWidth = size.width;
      targetHeight = size.height;
    } catch {
      console.warn(`  ⚠ 无法读取参考图: ${refFileName}，跳过`);
      skipped.push(section.index);
      continue;
    }

    const aspectRatio = chooseAspectRatio(targetWidth, targetHeight);

    // 解析素材
    const { paths: materialPaths, missing } = await resolveMaterials(section, deliveryBase, colorMap);

    if (materialPaths.length === 0) {
      console.warn(`  ⚠ #${section.index} 所有素材缺失 (${missing.join(', ')})，跳过`);
      skipped.push(section.index);
      continue;
    }

    if (missing.length > 0) {
      console.warn(`  ⚠ #${section.index} 部分素材缺失: ${missing.join(', ')}，使用已有素材继续`);
    }

    const promptText = buildPrompt(section, materialPaths);
    const outputDir = path.join(deliveryBase, '7_790（天猫）');
    const outputPath = path.join(outputDir, refFileName);
    const matNames = materialPaths.map(p => path.basename(p)).join(' + ');
    const label = `#${section.index} (${section.type}) ← ${matNames}`;

    tasks.push({
      index: section.index,
      refPath,
      materialPaths,
      promptText,
      outputPath,
      label,
      targetWidth,
      targetHeight,
      aspectRatio,
    });
  }

  // 输出任务摘要
  const filterParts = [];
  if (includes.length) filterParts.push(`包含: ${includes.join(', ')}`);
  if (excludes.length) filterParts.push(`排除: ${excludes.join(', ')}`);

  console.log(`\n款式: ${styleName}`);
  console.log(`主色(color1): ${color1}, 副色(color2): ${color2}`);
  if (filterParts.length) console.log(`过滤: ${filterParts.join(' | ')}`);
  if (skipped.length) console.log(`跳过: #${skipped.join(', #')}`);
  console.log(`总任务: ${tasks.length} 张, 并发: ${CONCURRENCY}\n`);

  if (tasks.length === 0) {
    console.log('无任务可执行，退出');
    process.exit(0);
  }

  // 确保输出目录存在
  const outputDir = path.join(deliveryBase, '7_790（天猫）');
  await fs.mkdir(outputDir, { recursive: true });

  const startTime = Date.now();

  const results = await runConcurrent(
    tasks.map(t => () => generateOne(t)),
    CONCURRENCY,
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const success = results.filter(Boolean).length;

  console.log(`\n全部完成! ${success}/${tasks.length} 张, 耗时 ${elapsed}s`);
  if (skipped.length) console.log(`跳过(素材缺失): #${skipped.join(', #')}`);
  console.log(`输出目录: ${outputDir}`);
}

main().catch(err => {
  console.error('执行失败:', err);
  process.exit(1);
});
