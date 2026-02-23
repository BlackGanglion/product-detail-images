import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/default.js';
import { generateAllGroups, regenerateSingle } from './generator/modelImage.js';
import { generateSection, stitchSections } from './composer/detailPage.js';
import { saveBase64Image } from './utils/image.js';
import {
  createSession, saveSession, loadSession,
  listSessions, deleteSession, getSessionDir,
} from './session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Current active session
let session = null;

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

  // --- Session / History APIs ---
  if (req.method === 'GET' && url.pathname === '/api/session') {
    return jsonResponse(res, 200, getSessionSummary());
  }
  if (req.method === 'POST' && url.pathname === '/api/session/new') {
    return handleNewSession(req, res);
  }
  if (req.method === 'GET' && url.pathname === '/api/history') {
    return handleListHistory(req, res);
  }
  if (req.method === 'POST' && url.pathname === '/api/history/restore') {
    return handleRestoreSession(req, res);
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/history/')) {
    const id = url.pathname.slice('/api/history/'.length);
    return handleDeleteSession(id, res);
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

  jsonResponse(res, 404, { error: 'Not found' });
}

// ==================== Helper: session-relative URL ====================

function sessionUrl(relativePath) {
  return `/session/${session.sessionId}/${relativePath}`;
}

function sessionPath(relativePath) {
  return path.join(getSessionDir(session.sessionId), relativePath);
}

function getSessionSummary() {
  if (!session) return { sessionId: null };
  return {
    sessionId: session.sessionId,
    status: session.status,
    createdAt: session.createdAt,
    modelFront: session.modelFront?.name || null,
    modelBack: session.modelBack?.name || null,
    clothesGroups: session.clothesGroups.map(g => ({
      groupId: g.groupId, label: g.label,
      frontName: g.frontName || null, backName: g.backName || null,
    })),
    additionalNotes: session.additionalNotes || '',
    step1Results: session.step1Results.map(r => ({
      groupId: r.groupId,
      front: sessionUrl(`step1/${r.groupId}-front.jpg`),
      back: sessionUrl(`step1/${r.groupId}-back.jpg`),
    })),
    detailRefs: session.detailRefs.map(r => ({ index: r.index, name: r.name })),
    step2Results: session.step2Results.map(r => ({
      index: r.index,
      url: sessionUrl(`step2/section-${String(r.index + 1).padStart(2, '0')}.jpg`),
    })),
    finalPath: session.finalPath ? sessionUrl('final/detail-page.jpg') : null,
  };
}

// ==================== Session / History Handlers ====================

async function handleNewSession(req, res) {
  session = await createSession();
  console.log(`New session created: ${session.sessionId}`);
  jsonResponse(res, 200, getSessionSummary());
}

async function handleListHistory(req, res) {
  const list = await listSessions();
  jsonResponse(res, 200, { sessions: list });
}

async function handleRestoreSession(req, res) {
  const body = await readJsonBody(req);
  const { sessionId } = body;
  try {
    session = await loadSession(sessionId);
    console.log(`Session restored: ${sessionId}`);
    jsonResponse(res, 200, getSessionSummary());
  } catch (err) {
    jsonResponse(res, 404, { error: `Session not found: ${sessionId}` });
  }
}

async function handleDeleteSession(sessionId, res) {
  try {
    await deleteSession(sessionId);
    // If we deleted the active session, create a new one
    if (session && session.sessionId === sessionId) {
      session = await createSession();
    }
    jsonResponse(res, 200, { ok: true, activeSessionId: session.sessionId });
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
  const { files } = body; // [{ name, data }]

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
    session.detailRefs.push({ index: idx, name: f.name, path: filePath });
  }

  await saveSession(session.sessionId, session);
  jsonResponse(res, 200, {
    ok: true,
    count: session.detailRefs.length,
    detailRefs: session.detailRefs.map(r => ({ index: r.index, name: r.name })),
  });
}

async function handleStep2Generate(req, res) {
  if (session.detailRefs.length === 0) {
    return jsonResponse(res, 400, { error: '请先上传详情页参考图' });
  }
  if (session.step1Results.length === 0) {
    return jsonResponse(res, 400, { error: '请先完成 Step1 生成' });
  }

  const modelImagePaths = [];
  for (const r of session.step1Results) {
    modelImagePaths.push(r.front);
    modelImagePaths.push(r.back);
  }

  // Only generate for refs that don't have results yet
  const doneIndexes = new Set(session.step2Results.map(r => r.index));
  const pending = session.detailRefs.filter(r => !doneIndexes.has(r.index));

  if (pending.length === 0) {
    return jsonResponse(res, 400, { error: '所有参考图都已生成, 请上传新的参考图或重新生成单张' });
  }

  const step2Dir = sessionPath('step2');
  console.log(`\nStarting Step2 generation: ${pending.length} pending sections (${session.detailRefs.length} total), ${modelImagePaths.length} model images`);

  const results = [];

  for (const ref of pending) {
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
  const { index } = body;

  const ref = session.detailRefs.find(r => r.index === index);
  if (!ref) return jsonResponse(res, 400, { error: `Section ${index} not found.` });

  const modelImagePaths = [];
  for (const r of session.step1Results) {
    modelImagePaths.push(r.front);
    modelImagePaths.push(r.back);
  }

  const step2Dir = sessionPath('step2');
  const outputPath = await generateSection({
    refImagePath: ref.path,
    modelImagePaths,
    index: ref.index,
    outputDir: step2Dir,
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
    detailRefs: session.detailRefs.map(r => ({ index: r.index, name: r.name })),
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
  // Try to load the most recent session, otherwise create a new one
  const sessions = await listSessions();
  if (sessions.length > 0) {
    try {
      session = await loadSession(sessions[0].sessionId);
      console.log(`Resumed session: ${session.sessionId} (status: ${session.status})`);
    } catch {
      session = await createSession();
      console.log(`Created new session: ${session.sessionId}`);
    }
  } else {
    session = await createSession();
    console.log(`Created new session: ${session.sessionId}`);
  }
}

const PORT = config.server.port;
init().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
});
