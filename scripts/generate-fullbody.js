import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { fileToBase64, mimeType, saveBase64Image } from '../src/utils/image.js';
import { generateImage } from '../src/api/nanoBanana.js';
import config from '../config/default.js';

// ── 配置 ──────────────────────────────────────────────
const ROOT = process.cwd();
const REF_DIR = path.join(ROOT, '参考/1_精修图/全身照-{花色}');
const SHIPAI_DIR = path.join(ROOT, '实拍');
const DELIVERY_DIR = path.join(ROOT, '交付');
const CONCURRENCY = config.generation.concurrency || 3;
const OUTPUT_WIDTH = 2000;
const OUTPUT_HEIGHT = 3000;

// ── 款式类型判断 ──────────────────────────────────────
function isSweater(styleName) {
  return styleName.startsWith('羊');
}

// 实拍/交付目录名可能不含"款"，自动适配
async function resolveDir(baseDir, styleName) {
  const direct = path.join(baseDir, styleName);
  try { await fs.access(direct); return direct; } catch {}
  const stripped = path.join(baseDir, styleName.replace(/款$/, ''));
  try { await fs.access(stripped); return stripped; } catch {}
  return direct; // fallback, 让后续报错
}

// 实拍图文件扩展名自适应 (.JPG / .jpg / .jpeg)
async function resolveShipaiPhoto(dir, fileName) {
  for (const ext of ['.JPG', '.jpg', '.jpeg', '.png']) {
    const p = path.join(dir, `${fileName}${ext}`);
    try { await fs.access(p); return p; } catch {}
  }
  return path.join(dir, `${fileName}.JPG`); // fallback
}

// 参考全身照文件名 → 输出后缀名
const REF_PHOTOS = [
  { ref: '全身_正面_1.JPG', suffix: '全身_正面_1' },
  { ref: '全身_侧面_2.JPG', suffix: '全身_侧面_2' },
  { ref: '全身_敞开_3.JPG', suffix: '全身_敞开_3' },
  { ref: '全身_正面_4.JPG', suffix: '全身_正面_4' },
  { ref: '全身_正面_5.JPG', suffix: '全身_正面_5' },
  { ref: '全身_正面_6.JPG', suffix: '全身_正面_6' },
  { ref: '全身_背面_7.JPG', suffix: '全身_背面_7' },
];

// ── 加载匹配和 prompt 数据 ──────────────────────────
async function loadConfig() {
  const matching = JSON.parse(await fs.readFile(path.join(ROOT, '全身照匹配.json'), 'utf-8'));
  const prompts = JSON.parse(await fs.readFile(path.join(ROOT, '全身照prompts.json'), 'utf-8'));
  return { matching, prompts };
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
async function generateOne({ refPhotoPath, shipaiPhotoPath, promptText, outputPath, label }) {
  console.log(`  [开始] ${label}`);

  const [refBase64, shipaiBase64] = await Promise.all([
    fileToBase64(refPhotoPath),
    fileToBase64(shipaiPhotoPath),
  ]);
  const refMime = mimeType(refPhotoPath);
  const shipaiMime = mimeType(shipaiPhotoPath);

  const imageData = await generateImage(promptText, [
    { mimeType: refMime, base64: refBase64 },
    { mimeType: shipaiMime, base64: shipaiBase64 },
  ]);

  await saveBase64Image(imageData, outputPath);

  // resize 到参考图尺寸 2000x3000
  await sharp(outputPath)
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: 'fill' })
    .jpeg({ quality: 95 })
    .toFile(outputPath + '.tmp');
  await fs.rename(outputPath + '.tmp', outputPath);

  console.log(`  [完成] ${label} → ${path.basename(outputPath)} (${OUTPUT_WIDTH}x${OUTPUT_HEIGHT})`);
  return outputPath;
}

// ── 姿势特定 prompt 补充 ────────────────────────────
const POSE_PROMPTS = {
  '正面_1': `CRITICAL POSE NOTE: In Image 1, the model is NOT wearing the vest. She is HOLDING a tightly FOLDED vest in her left hand at waist height, like a small clutch purse. The folded vest is VERY COMPACT — roughly the size of a book or small handbag. Her right hand gently touches her left wrist area. You MUST:
1) The folded vest SHAPE and SIZE must be PIXEL-PERFECT identical to Image 1. Study Image 1 carefully — copy the EXACT outline, proportions, and silhouette of the folded bundle.
2) The vest must be tightly folded with NO visible armholes, NO sleeve openings, NO loose fabric hanging out. It is a compact, neat bundle — all edges are tucked in.
3) Hold it in the SAME position: left hand, at waist level, against her left side.
4) The model must NOT wear the vest. She is only carrying it folded.
5) Only replace the vest FABRIC PATTERN visible on the folded bundle — keep the EXACT same folded shape, size, and outline as Image 1. Do NOT make it larger, wider, or more spread out than in Image 1.`,

  背面: `CRITICAL POSE OVERRIDE: Image 1 shows the model from the BACK (rear view) — the model is facing AWAY from the camera, and her face is NOT visible. Image 2 shows the BACK side of the target vest. You MUST:
1) Keep the model facing AWAY from the camera exactly as in Image 1.
2) Show the BACK of the vest — the back panel, back neckline — NOT the front.
3) Do NOT show the model's face. The back of the head/hair should be visible.
4) Ignore any instructions about "same face/expression" for this back-view shot.
5) THE BACK OF THE VEST HAS ZERO VERTICAL LINES — NO center back seam, NO vertical stitching, NO vertical creases, NO vertical lines whatsoever. The back is ONE SINGLE UNBROKEN PIECE of brocade fabric. Any vertical lines you see in Image 2 are storage fold marks that do NOT exist on the actual garment — you MUST completely ignore them. The generated back must show ONLY the brocade pattern flowing smoothly across the entire back surface with absolutely no lines dividing it.`,

  侧面: `POSE NOTE: Image 1 shows the model from the SIDE (profile view). Image 2 shows the vest from a similar side angle. Reproduce this exact side angle — show the vest's side profile, how it drapes from the side, and maintain the same profile silhouette as Image 1. MOST CRITICAL — CLOSURE/BUTTON ACCURACY: From the side view, you can see the vest's front edge closures. Copy the EXACT closure style from Image 2 — do NOT invent your own buttons. In Image 2, the closures are traditional Chinese frog closures (盘扣/pankou): each one is a pair of hand-tied fabric cord loops forming a symmetrical knot pattern, roughly 2-3cm wide, sitting flat against the fabric. They are NOT round buttons, NOT gold buttons, NOT metal snaps, NOT toggles with holes. They are FLAT FABRIC CORD KNOTS. Look at Image 2 very carefully and reproduce the closures EXACTLY as they appear — their shape, size, color, spacing, and position along the front edge.`,

  敞开: `POSE NOTE: Image 1 shows the model wearing the vest OPEN/UNBUTTONED, with the front panels spread apart showing the inner lining or outfit underneath. The vest in the generated image must also be worn OPEN in the same way, with front panels spread to the same degree as Image 1.`,
};

// ── 针织衫姿势特定 prompt 补充 ──────────────────────
const SWEATER_POSE_PROMPTS = {
  '正面_1': `CRITICAL POSE NOTE: In Image 1, the model is holding a folded garment in her left hand at waist height. For this sweater: the model should be in the EXACT SAME POSE — same body position, same hand positions — but instead of holding a folded vest, she is holding the TARGET SWEATER folded into a compact bundle. ONLY replace the fabric pattern/color on the folded item with the sweater's pattern from Image 2. Keep the folded bundle the SAME SIZE and SHAPE as Image 1. The model is NOT wearing the sweater — she is only carrying it folded. IMPORTANT: The model's black velvet outfit underneath remains EXACTLY unchanged.`,

  背面: `CRITICAL POSE OVERRIDE: Image 1 shows the model from the BACK (rear view) — the model is facing AWAY from the camera. You MUST:
1) Keep the model facing AWAY from the camera exactly as in Image 1.
2) The model is WEARING the target sweater — show the BACK of the sweater with its yoke pattern visible from behind.
3) Do NOT show the model's face. The back of the head/hair should be visible.
4) The sweater replaces BOTH the vest AND the underlying black top — the entire upper body garment is the knit sweater. The black pants remain unchanged.
5) The sweater's batwing sleeves should be visible, covering the model's arms.`,

  侧面: `POSE NOTE: Image 1 shows the model from the SIDE (profile view). The model is WEARING the target sweater. Show the sweater from this side angle — how the batwing sleeve drapes, the side profile of the yoke/chest pattern. The sweater replaces the entire top (both vest and underlying top). Maintain the same profile silhouette as Image 1. The sweater is a PULLOVER with NO front opening, NO buttons, NO closures.`,

  敞开: `POSE NOTE: Image 1 shows the model with a vest worn open. Since the target is a PULLOVER SWEATER (no front opening), the model should be WEARING the sweater normally pulled on. The sweater is a PULLOVER — it CANNOT be worn open. Show the front of the sweater with the full pattern visible. Keep the same body pose as Image 1 but with the sweater worn closed/normally. The sweater replaces BOTH the vest AND the underlying black top.`,
};

// ── 构建完整 prompt ─────────────────────────────────
function buildPrompt({ basePrompt, colorPrompt, refKey, sweater }) {
  const poseMap = sweater ? SWEATER_POSE_PROMPTS : POSE_PROMPTS;
  let poseExtra = '';
  for (const [keyword, extra] of Object.entries(poseMap)) {
    if (refKey.includes(keyword)) {
      poseExtra = '\n\n' + extra;
      break;
    }
  }
  return basePrompt + '\n\n' + colorPrompt + poseExtra;
}

// ── 收集所有任务 ────────────────────────────────────
async function collectTasks({ styleName, matching, prompts }) {
  const sweater = isSweater(styleName);
  const colors = Object.keys(matching[styleName].花色);
  const basePrompt = sweater ? prompts.sweater_base_prompt : prompts.base_prompt;
  const tasks = [];

  // 解析实拍/交付目录（可能不含"款"）
  const shipaiDir = await resolveDir(SHIPAI_DIR, styleName);
  const deliveryBase = await resolveDir(DELIVERY_DIR, styleName);

  if (sweater) {
    console.log(`  类型: 针织衫 (使用 sweater_base_prompt)`);
  }

  for (const color of colors) {
    const colorPrompt = prompts[styleName][color];
    if (!colorPrompt) {
      console.warn(`  ⚠ 未找到 ${color} 的 prompt，跳过`);
      continue;
    }

    const matchMap = matching[styleName].花色[color].全身照匹配;
    const outputDir = path.join(deliveryBase, '1_精修图/全身照');

    for (const photo of REF_PHOTOS) {
      const refKey = photo.suffix;
      const shipaiFile = matchMap[refKey];
      if (!shipaiFile) {
        console.warn(`  ⚠ 未找到匹配: ${styleName}/${color}/${refKey}`);
        continue;
      }

      const refPhotoPath = path.join(REF_DIR, photo.ref);
      const shipaiPhotoPath = await resolveShipaiPhoto(shipaiDir, shipaiFile);
      const outputFileName = `${color}_${photo.suffix}.jpg`;
      const outputPath = path.join(outputDir, outputFileName);
      const label = `${color}/${photo.suffix} ← ${shipaiFile}`;
      const promptText = buildPrompt({ basePrompt, colorPrompt, refKey, sweater });

      tasks.push({ color, refPhotoPath, shipaiPhotoPath, promptText, outputPath, label });
    }
  }

  return tasks;
}

// ── 主入口 ──────────────────────────────────────────
async function main() {
  const styleName = process.argv[2]; // e.g. '马甲2599款'
  const filters = process.argv.slice(3); // e.g. '背面' 或 '金色 正面_5' — 可选，多个条件取交集
  if (!styleName) {
    console.error('用法: node scripts/generate-fullbody.js <款式名> [过滤条件...]');
    console.error('例如: node scripts/generate-fullbody.js 马甲2599款');
    console.error('      node scripts/generate-fullbody.js 马甲2599款 背面');
    console.error('      node scripts/generate-fullbody.js 马甲2599款 金色 正面_5');
    process.exit(1);
  }

  const { matching, prompts } = await loadConfig();

  if (!matching[styleName]) {
    console.error(`未找到款式: ${styleName}`);
    process.exit(1);
  }
  if (!prompts[styleName]) {
    console.error(`未找到 prompt: ${styleName}`);
    process.exit(1);
  }

  let tasks = await collectTasks({ styleName, matching, prompts });
  const includes = filters.filter(f => !f.startsWith('^'));
  const excludes = filters.filter(f => f.startsWith('^')).map(f => f.slice(1));
  if (includes.length > 0 || excludes.length > 0) {
    tasks = tasks.filter(t =>
      includes.every(f => t.label.includes(f)) &&
      excludes.every(f => !t.label.includes(f))
    );
    const parts = [];
    if (includes.length) parts.push(`包含: ${includes.map(f => `"${f}"`).join(' + ')}`);
    if (excludes.length) parts.push(`排除: ${excludes.map(f => `"${f}"`).join(', ')}`);
    console.log(`\n过滤: ${parts.join(' | ')}`);
  }

  const colors = [...new Set(tasks.map(t => t.color))];

  console.log(`\n款式: ${styleName}`);
  console.log(`花色: ${colors.join(', ')}`);
  console.log(`总任务: ${tasks.length} 张, 并发: ${CONCURRENCY}\n`);

  // 确保输出目录存在
  const deliveryBase = await resolveDir(DELIVERY_DIR, styleName);
  const outputDir = path.join(deliveryBase, '1_精修图/全身照');
  await fs.mkdir(outputDir, { recursive: true });

  const startTime = Date.now();

  const results = await runConcurrent(
    tasks.map(t => () => generateOne(t)),
    CONCURRENCY,
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const success = results.filter(Boolean).length;

  // 按花色统计
  for (const color of colors) {
    const colorTasks = tasks.filter(t => t.color === color);
    const colorSuccess = colorTasks.filter((_, i) => results[tasks.indexOf(colorTasks[0]) + i]).length;
    console.log(`  ${color}: ${colorSuccess}/${colorTasks.length} 张`);
  }

  console.log(`\n全部完成! ${success}/${tasks.length} 张, 耗时 ${elapsed}s`);
}

main().catch(err => {
  console.error('执行失败:', err);
  process.exit(1);
});
