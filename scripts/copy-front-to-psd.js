/**
 * 羊毛衣服：从 1_精修图/全身照 为每个花色选取2张正面图，拷贝到 2_抠图PSD，命名为 抠图_{花色}_序号
 */
import fs from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const DELIVERY_DIR = path.join(ROOT, '交付');

// 羊毛款式前缀
const WOOL_PREFIX = '羊';

// 正面图优先顺序（选取每花色一张时使用）
const FRONT_PRIORITY = ['全身_正面_4', '全身_正面_5', '全身_正面_6', '全身_正面_1'];

function isWoolStyle(name) {
  return name.startsWith(WOOL_PREFIX);
}

async function main() {
  const entries = await fs.readdir(DELIVERY_DIR, { withFileTypes: true });
  const woolStyles = entries.filter(e => e.isDirectory() && isWoolStyle(e.name)).map(e => e.name);

  console.log(`羊毛款式: ${woolStyles.join(', ')}\n`);

  for (const style of woolStyles) {
    const fullbodyDir = path.join(DELIVERY_DIR, style, '1_精修图', '全身照');
    const psdDir = path.join(DELIVERY_DIR, style, '2_抠图PSD');

    try {
      await fs.access(fullbodyDir);
    } catch {
      console.log(`  ${style}: 无 1_精修图/全身照，跳过`);
      continue;
    }

    const files = await fs.readdir(fullbodyDir);
    const frontFiles = files.filter(f => f.includes('正面') && /\.(jpg|jpeg|png)$/i.test(f));

    // 按花色分组 { 黑橙色: ['黑橙色_全身_正面_4.jpg', ...], ... }
    const byColor = {};
    for (const f of frontFiles) {
      const color = f.replace(/_.*/, '');
      if (!byColor[color]) byColor[color] = [];
      byColor[color].push(f);
    }

    const colors = Object.keys(byColor).sort();
    const needPerColor = 2; // 每个花色2张正面

    const toCopy = []; // { color, file }
    for (const color of colors) {
      const list = byColor[color];
      for (const suffix of FRONT_PRIORITY) {
        if (toCopy.filter(t => t.color === color).length >= needPerColor) break;
        const name = `${color}_${suffix}`;
        const found = list.find(f => f.startsWith(name) && /\.(jpg|jpeg|png)$/i.test(f));
        if (found) toCopy.push({ color, file: found });
      }
    }

    if (toCopy.length === 0) {
      console.log(`  ${style}: 无正面图，跳过`);
      continue;
    }

    await fs.mkdir(psdDir, { recursive: true });
    const existing = await fs.readdir(psdDir);
    for (const f of existing) {
      if (f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png')) {
        await fs.unlink(path.join(psdDir, f));
      }
    }
    const ext = path.extname(toCopy[0].file);
    const colorSeq = {};
    for (const { color, file } of toCopy) {
      colorSeq[color] = (colorSeq[color] || 0) + 1;
      const seq = colorSeq[color];
      const destName = `抠图_${color}_${seq}${ext}`;
      const src = path.join(fullbodyDir, file);
      const dest = path.join(psdDir, destName);
      await fs.copyFile(src, dest);
      console.log(`  ${style}: ${file} → 2_抠图PSD/${destName}`);
    }
    console.log('');
  }

  console.log('完成');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
