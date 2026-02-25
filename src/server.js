import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/default.js';
import { generateAllGroups, regenerateSingle } from './generator/modelImage.js';
import { generateSection, stitchSections } from './composer/detailPage.js';
import { generateRetouch, generateAllRetouches } from './generator/retouchImage.js';
import { generateClothingDetail, generateAllClothingDetails } from './generator/clothingDetailImage.js';
import { saveBase64Image } from './utils/image.js';
import {
  createSession, saveSession, loadSession,
  listSessions, deleteSession, getSessionDir,
} from './session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Active sessions — isolated per page type
let session = null;               // detail page
let retouchSession = null;        // retouch page
let clothingDetailSession = null; // clothing detail page

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error('Server error:', err);
    jsonResponse(res, 500, { error: err.message });
  }
});

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Serve static files
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return serveFile(res, path.join(ROOT, 'public/index.html'), 'text/html');
  }

  if (req.method === 'GET' && url.pathname === '/resize.html') {
    return serveFile(res, path.join(ROOT, 'public/resize.html'), 'text/html');
  }

  if (req.method === 'GET' && url.pathname === '/retouch.html') {
    return serveFile(res, path.join(ROOT, 'public/retouch.html'), 'text/html');
  }

  if (req.method === 'GET' && url.pathname === '/clothing-detail.html') {
    return serveFile(res, path.join(ROOT, 'public/clothing-detail.html'), 'text/html');
  }

  // Serve session files: /session/{sessionId}/...
  if (req.method === 'GET' && url.pathname.startsWith('/session/')) {
    const parts = url.pathname.slice('/session/'.length).split('/');
    const sessionId = parts[0];
    const rest = parts.slice(1).join('/');
    const filePath = path.join(getSessionDir(sessionId), rest);
    try {
      await fs.access(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      return serveFile(res, filePath, mime);
    } catch {
      return jsonResponse(res, 404, { error: 'File not found' });
    }
  }

  // --- Session / History APIs (type-aware via ?type=detail|retouch) ---
  if (req.method === 'GET' && url.pathname === '/api/session') {
    const type = url.searchParams.get('type') || 'detail';
    return jsonResponse(res, 200, getSessionSummary(type));
  }
  if (req.method === 'POST' && url.pathname === '/api/session/new') {
    return handleNewSession(req, res);
  }
  if (req.method === 'GET' && url.pathname === '/api/history') {
    const type = url.searchParams.get('type') || 'detail';
    return handleListHistory(type, res);
  }
  if (req.method === 'POST' && url.pathname === '/api/history/restore') {
    return handleRestoreSession(req, res);
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/history/')) {
    const id = url.pathname.slice('/api/history/'.length);
    return handleDeleteSession(req, id, res);
  }

  // --- Step1 APIs ---
  if (req.method === 'POST' && url.pathname === '/api/upload') return handleUpload(req, res);
  if (req.method === 'POST' && url.pathname === '/api/generate') return handleGenerate(req, res);
  if (req.method === 'POST' && url.pathname === '/api/regenerate') return handleRegenerate(req, res);

  // --- Step2 APIs ---
  if (req.method === 'POST' && url.pathname === '/api/step2/upload') return handleStep2Upload(req, res);
  if (req.method === 'POST' && url.pathname === '/api/step2/generate') return handleStep2Generate(req, res);
  if (req.method === 'POST' && url.pathname === '/api/step2/regenerate') return handleStep2Regenerate(req, res);
  if (req.method === 'POST' && url.pathname === '/api/step2/stitch') return handleStitch(req, res);
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/step2/ref/')) {
    const index = parseInt(url.pathname.slice('/api/step2/ref/'.length), 10);
    return handleStep2DeleteRef(index, res);
  }

  // --- Retouch APIs ---
  if (req.method === 'POST' && url.pathname === '/api/retouch/upload') return handleRetouchUpload(req, res);
  if (req.method === 'POST' && url.pathname === '/api/retouch/generate') return handleRetouchGenerate(req, res);
  if (req.method === 'POST' && url.pathname === '/api/retouch/regenerate') return handleRetouchRegenerate(req, res);
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/retouch/model-ref/')) {
    const index = parseInt(url.pathname.slice('/api/retouch/model-ref/'.length), 10);
    return handleRetouchDeleteModelRef(index, res);
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/retouch/clothing-ref/')) {
    const index = parseInt(url.pathname.slice('/api/retouch/clothing-ref/'.length), 10);
    return handleRetouchDeleteClothingRef(index, res);
  }

  // --- Clothing Detail APIs ---
  if (req.method === 'POST' && url.pathname === '/api/clothing-detail/upload') return handleCDUpload(req, res);
  if (req.method === 'POST' && url.pathname === '/api/clothing-detail/generate') return handleCDGenerate(req, res);
  if (req.method === 'POST' && url.pathname === '/api/clothing-detail/regenerate') return handleCDRegenerate(req, res);
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/clothing-detail/detail-ref/')) {
    const index = parseInt(url.pathname.slice('/api/clothing-detail/detail-ref/'.length), 10);
    return handleCDDeleteDetailRef(index, res);
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/clothing-detail/clothing-ref/')) {
    const index = parseInt(url.pathname.slice('/api/clothing-detail/clothing-ref/'.length), 10);
    return handleCDDeleteClothingRef(index, res);
  }

  jsonResponse(res, 404, { error: 'Not found' });
}

// ==================== Helper: session-relative URL ====================

function sessionUrl(relativePath) {
  return `/session/${session.sessionId}/${relativePath}`;
}

function sessionPath(relativePath) {
  return path.join(getSessionDir(session.sessionId), relativePath);
}

function retouchSessionUrl(relativePath) {
  return `/session/${retouchSession.sessionId}/${relativePath}`;
}

function retouchSessionPath(relativePath) {
  return path.join(getSessionDir(retouchSession.sessionId), relativePath);
}

function cdSessionUrl(relativePath) {
  return `/session/${clothingDetailSession.sessionId}/${relativePath}`;
}

function cdSessionPath(relativePath) {
  return path.join(getSessionDir(clothingDetailSession.sessionId), relativePath);
}

function getSessionSummary(type = 'detail') {
  if (type === 'clothingDetail') {
    if (!clothingDetailSession) return { sessionId: null, type: 'clothingDetail' };
    return {
      sessionId: clothingDetailSession.sessionId,
      type: 'clothingDetail',
      status: clothingDetailSession.status,
      createdAt: clothingDetailSession.createdAt,
      cdDetailRefs: (clothingDetailSession.cdDetailRefs || []).map(r => ({ index: r.index, name: r.name })),
      cdClothingRefs: (clothingDetailSession.cdClothingRefs || []).map(r => ({ index: r.index, name: r.name })),
      cdResults: (clothingDetailSession.cdResults || []).map(r => ({
        index: r.index,
        url: cdSessionUrl(`clothing-detail/result-${String(r.index + 1).padStart(2, '0')}.jpg`),
      })),
      cdNotes: clothingDetailSession.cdNotes || '',
    };
  }
  if (type === 'retouch') {
    if (!retouchSession) return { sessionId: null, type: 'retouch' };
    return {
      sessionId: retouchSession.sessionId,
      type: 'retouch',
      status: retouchSession.status,
      createdAt: retouchSession.createdAt,
      retouchModelRefs: (retouchSession.retouchModelRefs || []).map(r => ({ index: r.index, name: r.name })),
      retouchClothingRefs: (retouchSession.retouchClothingRefs || []).map(r => ({ index: r.index, name: r.name })),
      retouchResults: (retouchSession.retouchResults || []).map(r => ({
        index: r.index,
        url: retouchSessionUrl(`retouch/result-${String(r.index + 1).padStart(2, '0')}.jpg`),
      })),
      retouchNotes: retouchSession.retouchNotes || '',
    };
  }
  if (!session) return { sessionId: null, type: 'detail' };
  return {
    sessionId: session.sessionId,
    type: 'detail',
    status: session.status,
    createdAt: session.createdAt,
    modelFront: session.modelFront?.name || null,
    modelBack: session.modelBack?.name || null,
    clothesGroups: (session.clothesGroups || []).map(g => ({
      groupId: g.groupId, label: g.label,
      frontName: g.frontName || null, backName: g.backName || null,
    })),
    additionalNotes: session.additionalNotes || '',
    step1Results: (session.step1Results || []).map(r => ({
      groupId: r.groupId,
      front: sessionUrl(`step1/${r.groupId}-front.jpg`),
      back: sessionUrl(`step1/${r.groupId}-back.jpg`),
    })),
    detailRefs: (session.detailRefs || []).map(r => ({ index: r.index, name: r.name, sectionType: r.sectionType || 'detail' })),
    step2Results: (session.step2Results || []).map(r => ({
      index: r.index,
      url: sessionUrl(`step2/section-${String(r.index + 1).padStart(2, '0')}.jpg`),
    })),
    finalPath: session.finalPath ? sessionUrl('final/detail-page.jpg') : null,
  };
}

// ==================== Session / History Handlers ====================

async function handleNewSession(req, res) {
  const body = await readJsonBody(req);
  const type = body.type || 'detail';
  if (type === 'clothingDetail') {
    clothingDetailSession = await createSession('clothingDetail');
    console.log(`New clothingDetail session created: ${clothingDetailSession.sessionId}`);
  } else if (type === 'retouch') {
    retouchSession = await createSession('retouch');
    console.log(`New retouch session created: ${retouchSession.sessionId}`);
  } else {
    session = await createSession('detail');
    console.log(`New detail session created: ${session.sessionId}`);
  }
  jsonResponse(res, 200, getSessionSummary(type));
}

async function handleListHistory(type, res) {
  const list = await listSessions(type);
  jsonResponse(res, 200, { sessions: list });
}

async function handleRestoreSession(req, res) {
  const body = await readJsonBody(req);
  const { sessionId, type } = body;
  try {
    const loaded = await loadSession(sessionId);
    const sessionType = type || loaded.type || 'detail';
    if (sessionType === 'clothingDetail') {
      clothingDetailSession = loaded;
      console.log(`ClothingDetail session restored: ${sessionId}`);
    } else if (sessionType === 'retouch') {
      retouchSession = loaded;
      console.log(`Retouch session restored: ${sessionId}`);
    } else {
      session = loaded;
      console.log(`Detail session restored: ${sessionId}`);
    }
    jsonResponse(res, 200, getSessionSummary(sessionType));
  } catch (err) {
    jsonResponse(res, 404, { error: `Session not found: ${sessionId}` });
  }
}

async function handleDeleteSession(req, sessionId, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const type = url.searchParams.get('type') || 'detail';
  try {
    await deleteSession(sessionId);
    if (type === 'clothingDetail') {
      if (clothingDetailSession && clothingDetailSession.sessionId === sessionId) {
        clothingDetailSession = await createSession('clothingDetail');
      }
      jsonResponse(res, 200, { ok: true, activeSessionId: clothingDetailSession?.sessionId });
    } else if (type === 'retouch') {
      if (retouchSession && retouchSession.sessionId === sessionId) {
        retouchSession = await createSession('retouch');
      }
      jsonResponse(res, 200, { ok: true, activeSessionId: retouchSession?.sessionId });
    } else {
      if (session && session.sessionId === sessionId) {
        session = await createSession('detail');
      }
      jsonResponse(res, 200, { ok: true, activeSessionId: session?.sessionId });
    }
  } catch (err) {
    jsonResponse(res, 500, { error: err.message });
  }
}

// ==================== Step1 Handlers ====================

async function handleUpload(req, res) {
  const body = await readJsonBody(req);
  const { type, file, groupId, label } = body;

  const inputDir = sessionPath('input');
  await fs.mkdir(path.join(inputDir, 'model'), { recursive: true });
  await fs.mkdir(path.join(inputDir, 'clothes'), { recursive: true });

  if (type === 'modelFront' && file) {
    const filePath = path.join(inputDir, 'model', 'front' + extFromName(file.name));
    await saveBase64Image(file.data, filePath);
    session.modelFront = { name: file.name, path: filePath };
  } else if (type === 'modelBack' && file) {
    const filePath = path.join(inputDir, 'model', 'back' + extFromName(file.name));
    await saveBase64Image(file.data, filePath);
    session.modelBack = { name: file.name, path: filePath };
  } else if (type === 'clothesGroupFront' && file && groupId != null) {
    const filePath = path.join(inputDir, 'clothes', `${groupId}-front${extFromName(file.name)}`);
    await saveBase64Image(file.data, filePath);
    const group = getOrCreateGroup(groupId, label);
    group.frontName = file.name;
    group.frontPath = filePath;
  } else if (type === 'clothesGroupBack' && file && groupId != null) {
    const filePath = path.join(inputDir, 'clothes', `${groupId}-back${extFromName(file.name)}`);
    await saveBase64Image(file.data, filePath);
    const group = getOrCreateGroup(groupId, label);
    group.backName = file.name;
    group.backPath = filePath;
  } else if (type === 'removeGroup' && groupId != null) {
    session.clothesGroups = session.clothesGroups.filter(g => g.groupId !== groupId);
  }

  await saveSession(session.sessionId, session);
  jsonResponse(res, 200, { ok: true });
}

function getOrCreateGroup(groupId, label) {
  let group = session.clothesGroups.find(g => g.groupId === groupId);
  if (!group) {
    group = { groupId, label: label || groupId, frontName: null, frontPath: null, backName: null, backPath: null };
    session.clothesGroups.push(group);
  }
  if (label) group.label = label;
  return group;
}

async function handleGenerate(req, res) {
  const body = await readJsonBody(req);
  session.additionalNotes = body.additionalNotes || '';

  if (!session.modelFront || !session.modelBack) {
    return jsonResponse(res, 400, { error: '请先上传模特正面照和背面照' });
  }

  const validGroups = session.clothesGroups.filter(g => g.frontPath && g.backPath);
  if (validGroups.length === 0) {
    return jsonResponse(res, 400, { error: '请至少上传一组完整的衣服平铺图 (正面+背面)' });
  }

  const step1Dir = sessionPath('step1');
  console.log(`\nStarting Step1 generation: ${validGroups.length} groups`);

  const results = await generateAllGroups({
    modelFrontPath: session.modelFront.path,
    modelBackPath: session.modelBack.path,
    groups: validGroups.map(g => ({
      groupId: g.groupId,
      clothesFrontPath: g.frontPath,
      clothesBackPath: g.backPath,
    })),
    additionalNotes: session.additionalNotes,
    outputDir: step1Dir,
  });

  session.step1Results = results;
  session.status = 'step1_done';
  await saveSession(session.sessionId, session);

  jsonResponse(res, 200, {
    results: results.map(r => ({
      groupId: r.groupId,
      label: session.clothesGroups.find(g => g.groupId === r.groupId)?.label || r.groupId,
      front: sessionUrl(`step1/${r.groupId}-front.jpg`),
      back: sessionUrl(`step1/${r.groupId}-back.jpg`),
    })),
  });
}

async function handleRegenerate(req, res) {
  const body = await readJsonBody(req);
  const { groupId, side } = body;

  const group = session.clothesGroups.find(g => g.groupId === groupId);
  if (!group) return jsonResponse(res, 400, { error: `Group "${groupId}" not found.` });

  const step1Dir = sessionPath('step1');
  const outputPath = await regenerateSingle({
    modelFrontPath: session.modelFront.path,
    modelBackPath: session.modelBack.path,
    clothesFrontPath: group.frontPath,
    clothesBackPath: group.backPath,
    groupId, side,
    additionalNotes: session.additionalNotes,
    outputDir: step1Dir,
  });

  const existing = session.step1Results.find(r => r.groupId === groupId);
  if (existing) existing[side] = outputPath;

  await saveSession(session.sessionId, session);
  jsonResponse(res, 200, { groupId, side, url: sessionUrl(`step1/${groupId}-${side}.jpg`) });
}

// ==================== Step2 Handlers ====================

async function handleStep2Upload(req, res) {
  const body = await readJsonBody(req);
  const { files, sectionType = 'detail' } = body; // sectionType: 'showcase' | 'detail'

  const uploadDir = sessionPath('input/detail-refs');
  await fs.mkdir(uploadDir, { recursive: true });

  // Append: start index from max existing + 1
  const startIndex = session.detailRefs.length > 0
    ? Math.max(...session.detailRefs.map(r => r.index)) + 1
    : 0;

  for (let i = 0; i < files.length; i++) {
    const idx = startIndex + i;
    const f = files[i];
    const label = String(idx + 1).padStart(2, '0');
    const filePath = path.join(uploadDir, `${label}${extFromName(f.name)}`);
    await saveBase64Image(f.data, filePath);
    session.detailRefs.push({ index: idx, name: f.name, path: filePath, sectionType });
  }

  await saveSession(session.sessionId, session);
  jsonResponse(res, 200, {
    ok: true,
    count: session.detailRefs.length,
    detailRefs: session.detailRefs.map(r => ({ index: r.index, name: r.name, sectionType: r.sectionType || 'detail' })),
  });
}

async function handleStep2Generate(req, res) {
  if (session.detailRefs.length === 0) {
    return jsonResponse(res, 400, { error: '请先上传详情页参考图' });
  }
  if (session.step1Results.length === 0) {
    return jsonResponse(res, 400, { error: '请先完成 Step1 生成' });
  }

  // All model images (for detail type)
  const allModelImagePaths = [];
  for (const r of session.step1Results) {
    allModelImagePaths.push(r.front);
    allModelImagePaths.push(r.back);
  }

  // Only generate for refs that don't have results yet
  const doneIndexes = new Set(session.step2Results.map(r => r.index));
  const pending = session.detailRefs.filter(r => !doneIndexes.has(r.index));

  if (pending.length === 0) {
    return jsonResponse(res, 400, { error: '所有参考图都已生成, 请上传新的参考图或重新生成单张' });
  }

  const step2Dir = sessionPath('step2');
  console.log(`\nStarting Step2 generation: ${pending.length} pending sections (${session.detailRefs.length} total), ${allModelImagePaths.length} model images`);

  const results = [];

  for (const ref of pending) {
    // Determine which model images to pass based on sectionType
    const modelImagePaths = getModelImagesForRef(ref, allModelImagePaths);

    const outputPath = await generateSection({
      refImagePath: ref.path,
      modelImagePaths,
      index: ref.index,
      outputDir: step2Dir,
    });
    session.step2Results.push({ index: ref.index, path: outputPath });
    results.push({
      index: ref.index,
      name: ref.name,
      url: sessionUrl(`step2/section-${String(ref.index + 1).padStart(2, '0')}.jpg`),
    });
  }

  session.status = 'step2_done';
  await saveSession(session.sessionId, session);

  // Return ALL results (previously generated + newly generated)
  const allResults = session.detailRefs.map(ref => {
    const r = session.step2Results.find(s => s.index === ref.index);
    return {
      index: ref.index,
      name: ref.name,
      url: r ? sessionUrl(`step2/section-${String(ref.index + 1).padStart(2, '0')}.jpg`) : null,
      generated: !!r,
    };
  });
  jsonResponse(res, 200, { results: allResults, newCount: results.length });
}

async function handleStep2Regenerate(req, res) {
  const body = await readJsonBody(req);
  const { index, adjustmentPrompt } = body;

  const ref = session.detailRefs.find(r => r.index === index);
  if (!ref) return jsonResponse(res, 400, { error: `Section ${index} not found.` });

  const allModelImagePaths = [];
  for (const r of session.step1Results) {
    allModelImagePaths.push(r.front);
    allModelImagePaths.push(r.back);
  }

  // Use same sectionType-based routing as generate
  const modelImagePaths = getModelImagesForRef(ref, allModelImagePaths);

  const step2Dir = sessionPath('step2');
  const outputPath = await generateSection({
    refImagePath: ref.path,
    modelImagePaths,
    index: ref.index,
    outputDir: step2Dir,
    adjustmentPrompt,
  });

  const existing = session.step2Results.find(r => r.index === index);
  if (existing) {
    existing.path = outputPath;
  } else {
    session.step2Results.push({ index, path: outputPath });
  }

  await saveSession(session.sessionId, session);
  const label = String(index + 1).padStart(2, '0');
  jsonResponse(res, 200, { index, url: sessionUrl(`step2/section-${label}.jpg`) });
}

async function handleStep2DeleteRef(index, res) {
  const ref = session.detailRefs.find(r => r.index === index);
  if (!ref) return jsonResponse(res, 400, { error: `Section ${index} not found.` });

  // Remove ref and its result
  session.detailRefs = session.detailRefs.filter(r => r.index !== index);
  session.step2Results = session.step2Results.filter(r => r.index !== index);

  // Try to delete the files
  try { await fs.unlink(ref.path); } catch {}
  try {
    const label = String(index + 1).padStart(2, '0');
    await fs.unlink(sessionPath(`step2/section-${label}.jpg`));
  } catch {}

  await saveSession(session.sessionId, session);
  jsonResponse(res, 200, {
    ok: true,
    detailRefs: session.detailRefs.map(r => ({ index: r.index, name: r.name, sectionType: r.sectionType || 'detail' })),
  });
}

async function handleStitch(req, res) {
  if (session.step2Results.length === 0) {
    return jsonResponse(res, 400, { error: '没有可拼接的段落图' });
  }

  const sorted = [...session.step2Results].sort((a, b) => a.index - b.index);
  const paths = sorted.map(r => r.path);

  const finalDir = sessionPath('final');
  console.log(`\nStitching ${paths.length} sections...`);
  const finalPath = await stitchSections(paths, { outputDir: finalDir });
  session.finalPath = finalPath;
  session.status = 'finished';
  await saveSession(session.sessionId, session);

  jsonResponse(res, 200, { url: sessionUrl('final/detail-page.jpg') });
}

// ==================== Step2 Model Image Routing ====================

/**
 * Determine which model images to pass for a given ref based on its sectionType.
 * - 'showcase': match ref's ordinal position among showcase refs → corresponding color group
 * - 'detail': pass all model images (existing behavior)
 */
function getModelImagesForRef(ref, allModelImagePaths) {
  const sectionType = ref.sectionType || 'detail';

  if (sectionType === 'showcase') {
    // Find this ref's ordinal position among all showcase refs (sorted by index)
    const showcaseRefs = session.detailRefs
      .filter(r => (r.sectionType || 'detail') === 'showcase')
      .sort((a, b) => a.index - b.index);
    const ordinal = showcaseRefs.findIndex(r => r.index === ref.index);

    if (ordinal >= 0 && ordinal < session.step1Results.length) {
      const group = session.step1Results[ordinal];
      return [group.front, group.back];
    }
    // Fallback: if ordinal exceeds available groups, use all
    return allModelImagePaths;
  }

  if (sectionType === 'highlight') {
    const first = session.step1Results[0];
    if (first) return [first.front, first.back];
    return allModelImagePaths;
  }

  // unknown: pass all model images
  return allModelImagePaths;
}

// ==================== Retouch Handlers ====================

async function handleRetouchUpload(req, res) {
  const body = await readJsonBody(req);
  const { type } = body;
  const s = retouchSession;

  const uploadDir = retouchSessionPath('input/retouch');
  await fs.mkdir(uploadDir, { recursive: true });

  if (type === 'modelRef' && body.files) {
    // Batch upload model reference images
    const refs = s.retouchModelRefs || [];
    const startIndex = refs.length > 0 ? Math.max(...refs.map(r => r.index)) + 1 : 0;

    for (let i = 0; i < body.files.length; i++) {
      const idx = startIndex + i;
      const f = body.files[i];
      const label = String(idx + 1).padStart(2, '0');
      const filePath = path.join(uploadDir, `model-ref-${label}${extFromName(f.name)}`);
      await saveBase64Image(f.data, filePath);
      refs.push({ index: idx, name: f.name, path: filePath });
    }
    s.retouchModelRefs = refs;
  } else if (type === 'clothingRef' && body.files) {
    const refs = s.retouchClothingRefs || [];
    const startIndex = refs.length > 0 ? Math.max(...refs.map(r => r.index)) + 1 : 0;

    for (let i = 0; i < body.files.length; i++) {
      const idx = startIndex + i;
      const f = body.files[i];
      const label = String(idx + 1).padStart(2, '0');
      const filePath = path.join(uploadDir, `clothing-${label}${extFromName(f.name)}`);
      await saveBase64Image(f.data, filePath);
      refs.push({ index: idx, name: f.name, path: filePath });
    }
    s.retouchClothingRefs = refs;
  }

  await saveSession(s.sessionId, s);
  jsonResponse(res, 200, {
    ok: true,
    retouchModelRefs: (s.retouchModelRefs || []).map(r => ({ index: r.index, name: r.name })),
    retouchClothingRefs: (s.retouchClothingRefs || []).map(r => ({ index: r.index, name: r.name })),
  });
}

async function handleRetouchGenerate(req, res) {
  const body = await readJsonBody(req);
  const s = retouchSession;
  if (body.additionalNotes !== undefined) {
    s.retouchNotes = body.additionalNotes;
  }

  if (!s.retouchModelRefs || s.retouchModelRefs.length === 0) {
    return jsonResponse(res, 400, { error: '请先上传模特参考图' });
  }
  if (!s.retouchClothingRefs || s.retouchClothingRefs.length === 0) {
    return jsonResponse(res, 400, { error: '请至少上传一张实际穿着图' });
  }

  // Pending = model refs without results yet
  const doneIndexes = new Set((s.retouchResults || []).map(r => r.index));
  const pending = s.retouchModelRefs.filter(r => !doneIndexes.has(r.index));

  if (pending.length === 0) {
    return jsonResponse(res, 400, { error: '所有模特图都已生成, 请上传新的模特参考图或重新生成单张' });
  }

  const retouchDir = retouchSessionPath('retouch');
  const clothingRefPaths = s.retouchClothingRefs.map(r => r.path);
  console.log(`\nStarting retouch generation: ${pending.length} pending model refs, ${clothingRefPaths.length} clothing refs`);

  const results = await generateAllRetouches({
    modelRefs: pending,
    clothingRefPaths,
    additionalNotes: s.retouchNotes,
    outputDir: retouchDir,
  });

  s.retouchResults = [...(s.retouchResults || []), ...results];
  await saveSession(s.sessionId, s);

  // Return results indexed by model ref
  const allResults = s.retouchModelRefs.map(ref => {
    const r = s.retouchResults.find(x => x.index === ref.index);
    return {
      index: ref.index,
      name: ref.name,
      url: r ? retouchSessionUrl(`retouch/result-${String(ref.index + 1).padStart(2, '0')}.jpg`) : null,
      generated: !!r,
    };
  });
  jsonResponse(res, 200, { results: allResults, newCount: results.length });
}

async function handleRetouchRegenerate(req, res) {
  const body = await readJsonBody(req);
  const { index, adjustmentPrompt } = body;
  const s = retouchSession;

  // index is now model ref index
  const ref = (s.retouchModelRefs || []).find(r => r.index === index);
  if (!ref) return jsonResponse(res, 400, { error: `Model ref ${index} not found.` });
  if (!s.retouchClothingRefs || s.retouchClothingRefs.length === 0) {
    return jsonResponse(res, 400, { error: '没有穿着图可用' });
  }

  const retouchDir = retouchSessionPath('retouch');
  const clothingRefPaths = s.retouchClothingRefs.map(r => r.path);
  const outputPath = await generateRetouch({
    modelRefPath: ref.path,
    clothingRefPaths,
    additionalNotes: s.retouchNotes,
    adjustmentPrompt,
    outputDir: retouchDir,
    index: ref.index,
  });

  const existing = (s.retouchResults || []).find(r => r.index === index);
  if (existing) {
    existing.path = outputPath;
  } else {
    s.retouchResults = [...(s.retouchResults || []), { index, path: outputPath }];
  }

  await saveSession(s.sessionId, s);
  const label = String(index + 1).padStart(2, '0');
  jsonResponse(res, 200, { index, url: retouchSessionUrl(`retouch/result-${label}.jpg`) });
}

async function handleRetouchDeleteModelRef(index, res) {
  const s = retouchSession;
  const ref = (s.retouchModelRefs || []).find(r => r.index === index);
  if (!ref) return jsonResponse(res, 400, { error: `Model ref ${index} not found.` });

  // Remove model ref and its corresponding result
  s.retouchModelRefs = s.retouchModelRefs.filter(r => r.index !== index);
  s.retouchResults = (s.retouchResults || []).filter(r => r.index !== index);

  try { await fs.unlink(ref.path); } catch {}
  try {
    const label = String(index + 1).padStart(2, '0');
    await fs.unlink(retouchSessionPath(`retouch/result-${label}.jpg`));
  } catch {}

  await saveSession(s.sessionId, s);
  jsonResponse(res, 200, {
    ok: true,
    retouchModelRefs: s.retouchModelRefs.map(r => ({ index: r.index, name: r.name })),
  });
}

async function handleRetouchDeleteClothingRef(index, res) {
  const s = retouchSession;
  const ref = (s.retouchClothingRefs || []).find(r => r.index === index);
  if (!ref) return jsonResponse(res, 400, { error: `Clothing ref ${index} not found.` });

  // Remove clothing ref only — keep existing results (user can manually regenerate)
  s.retouchClothingRefs = s.retouchClothingRefs.filter(r => r.index !== index);

  try { await fs.unlink(ref.path); } catch {}

  await saveSession(s.sessionId, s);
  jsonResponse(res, 200, {
    ok: true,
    retouchClothingRefs: s.retouchClothingRefs.map(r => ({ index: r.index, name: r.name })),
  });
}

// ==================== Clothing Detail Handlers ====================

async function handleCDUpload(req, res) {
  const body = await readJsonBody(req);
  const { type } = body;
  const s = clothingDetailSession;

  const uploadDir = cdSessionPath('input/clothing-detail');
  await fs.mkdir(uploadDir, { recursive: true });

  if (type === 'detailRef' && body.files) {
    const refs = s.cdDetailRefs || [];
    const startIndex = refs.length > 0 ? Math.max(...refs.map(r => r.index)) + 1 : 0;

    for (let i = 0; i < body.files.length; i++) {
      const idx = startIndex + i;
      const f = body.files[i];
      const label = String(idx + 1).padStart(2, '0');
      const filePath = path.join(uploadDir, `detail-ref-${label}${extFromName(f.name)}`);
      await saveBase64Image(f.data, filePath);
      refs.push({ index: idx, name: f.name, path: filePath });
    }
    s.cdDetailRefs = refs;
  } else if (type === 'clothingRef' && body.files) {
    const refs = s.cdClothingRefs || [];
    const startIndex = refs.length > 0 ? Math.max(...refs.map(r => r.index)) + 1 : 0;

    for (let i = 0; i < body.files.length; i++) {
      const idx = startIndex + i;
      const f = body.files[i];
      const label = String(idx + 1).padStart(2, '0');
      const filePath = path.join(uploadDir, `clothing-${label}${extFromName(f.name)}`);
      await saveBase64Image(f.data, filePath);
      refs.push({ index: idx, name: f.name, path: filePath });
    }
    s.cdClothingRefs = refs;
  }

  await saveSession(s.sessionId, s);
  jsonResponse(res, 200, {
    ok: true,
    cdDetailRefs: (s.cdDetailRefs || []).map(r => ({ index: r.index, name: r.name })),
    cdClothingRefs: (s.cdClothingRefs || []).map(r => ({ index: r.index, name: r.name })),
  });
}

async function handleCDGenerate(req, res) {
  const body = await readJsonBody(req);
  const s = clothingDetailSession;
  if (body.additionalNotes !== undefined) {
    s.cdNotes = body.additionalNotes;
  }

  if (!s.cdDetailRefs || s.cdDetailRefs.length === 0) {
    return jsonResponse(res, 400, { error: '请先上传细节参考图' });
  }
  if (!s.cdClothingRefs || s.cdClothingRefs.length === 0) {
    return jsonResponse(res, 400, { error: '请至少上传一张替换衣服图' });
  }

  // Pending = detail refs without results yet
  const doneIndexes = new Set((s.cdResults || []).map(r => r.index));
  const pending = s.cdDetailRefs.filter(r => !doneIndexes.has(r.index));

  if (pending.length === 0) {
    return jsonResponse(res, 400, { error: '所有细节参考图都已生成, 请上传新的参考图或重新生成单张' });
  }

  const outputDir = cdSessionPath('clothing-detail');
  const clothingRefPaths = s.cdClothingRefs.map(r => r.path);
  console.log(`\nStarting clothing detail generation: ${pending.length} pending detail refs, ${clothingRefPaths.length} clothing refs`);

  const results = await generateAllClothingDetails({
    detailRefs: pending,
    clothingRefPaths,
    additionalNotes: s.cdNotes,
    outputDir,
  });

  s.cdResults = [...(s.cdResults || []), ...results];
  await saveSession(s.sessionId, s);

  const allResults = s.cdDetailRefs.map(ref => {
    const r = s.cdResults.find(x => x.index === ref.index);
    return {
      index: ref.index,
      name: ref.name,
      url: r ? cdSessionUrl(`clothing-detail/result-${String(ref.index + 1).padStart(2, '0')}.jpg`) : null,
      generated: !!r,
    };
  });
  jsonResponse(res, 200, { results: allResults, newCount: results.length });
}

async function handleCDRegenerate(req, res) {
  const body = await readJsonBody(req);
  const { index, adjustmentPrompt } = body;
  const s = clothingDetailSession;

  const ref = (s.cdDetailRefs || []).find(r => r.index === index);
  if (!ref) return jsonResponse(res, 400, { error: `Detail ref ${index} not found.` });
  if (!s.cdClothingRefs || s.cdClothingRefs.length === 0) {
    return jsonResponse(res, 400, { error: '没有替换衣服图可用' });
  }

  const outputDir = cdSessionPath('clothing-detail');
  const clothingRefPaths = s.cdClothingRefs.map(r => r.path);
  const outputPath = await generateClothingDetail({
    detailRefPath: ref.path,
    clothingRefPaths,
    additionalNotes: s.cdNotes,
    adjustmentPrompt,
    outputDir,
    index: ref.index,
  });

  const existing = (s.cdResults || []).find(r => r.index === index);
  if (existing) {
    existing.path = outputPath;
  } else {
    s.cdResults = [...(s.cdResults || []), { index, path: outputPath }];
  }

  await saveSession(s.sessionId, s);
  const label = String(index + 1).padStart(2, '0');
  jsonResponse(res, 200, { index, url: cdSessionUrl(`clothing-detail/result-${label}.jpg`) });
}

async function handleCDDeleteDetailRef(index, res) {
  const s = clothingDetailSession;
  const ref = (s.cdDetailRefs || []).find(r => r.index === index);
  if (!ref) return jsonResponse(res, 400, { error: `Detail ref ${index} not found.` });

  s.cdDetailRefs = s.cdDetailRefs.filter(r => r.index !== index);
  s.cdResults = (s.cdResults || []).filter(r => r.index !== index);

  try { await fs.unlink(ref.path); } catch {}
  try {
    const label = String(index + 1).padStart(2, '0');
    await fs.unlink(cdSessionPath(`clothing-detail/result-${label}.jpg`));
  } catch {}

  await saveSession(s.sessionId, s);
  jsonResponse(res, 200, {
    ok: true,
    cdDetailRefs: s.cdDetailRefs.map(r => ({ index: r.index, name: r.name })),
  });
}

async function handleCDDeleteClothingRef(index, res) {
  const s = clothingDetailSession;
  const ref = (s.cdClothingRefs || []).find(r => r.index === index);
  if (!ref) return jsonResponse(res, 400, { error: `Clothing ref ${index} not found.` });

  s.cdClothingRefs = s.cdClothingRefs.filter(r => r.index !== index);

  try { await fs.unlink(ref.path); } catch {}

  await saveSession(s.sessionId, s);
  jsonResponse(res, 200, {
    ok: true,
    cdClothingRefs: s.cdClothingRefs.map(r => ({ index: r.index, name: r.name })),
  });
}

// ==================== Helpers ====================

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function serveFile(res, filePath, contentType) {
  const data = await fs.readFile(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(data);
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function extFromName(name) {
  const ext = path.extname(name).toLowerCase();
  return ext || '.jpg';
}

// ==================== Startup ====================

async function init() {
  // Load or create detail session
  const detailSessions = await listSessions('detail');
  if (detailSessions.length > 0) {
    try {
      session = await loadSession(detailSessions[0].sessionId);
      console.log(`Resumed detail session: ${session.sessionId} (status: ${session.status})`);
    } catch {
      session = await createSession('detail');
      console.log(`Created new detail session: ${session.sessionId}`);
    }
  } else {
    session = await createSession('detail');
    console.log(`Created new detail session: ${session.sessionId}`);
  }

  // Load or create retouch session
  const retouchSessions = await listSessions('retouch');
  if (retouchSessions.length > 0) {
    try {
      retouchSession = await loadSession(retouchSessions[0].sessionId);
      console.log(`Resumed retouch session: ${retouchSession.sessionId} (status: ${retouchSession.status})`);
    } catch {
      retouchSession = await createSession('retouch');
      console.log(`Created new retouch session: ${retouchSession.sessionId}`);
    }
  } else {
    retouchSession = await createSession('retouch');
    console.log(`Created new retouch session: ${retouchSession.sessionId}`);
  }

  // Load or create clothingDetail session
  const cdSessions = await listSessions('clothingDetail');
  if (cdSessions.length > 0) {
    try {
      clothingDetailSession = await loadSession(cdSessions[0].sessionId);
      console.log(`Resumed clothingDetail session: ${clothingDetailSession.sessionId} (status: ${clothingDetailSession.status})`);
    } catch {
      clothingDetailSession = await createSession('clothingDetail');
      console.log(`Created new clothingDetail session: ${clothingDetailSession.sessionId}`);
    }
  } else {
    clothingDetailSession = await createSession('clothingDetail');
    console.log(`Created new clothingDetail session: ${clothingDetailSession.sessionId}`);
  }
}

const PORT = config.server.port;
init().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
});
