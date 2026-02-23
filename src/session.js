import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/default.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function sessionsDir() {
  return path.resolve(ROOT, config.sessions.dir);
}

function sessionDir(sessionId) {
  return path.join(sessionsDir(), sessionId);
}

function metaPath(sessionId) {
  return path.join(sessionDir(sessionId), 'meta.json');
}

/**
 * Create a new session — generates ID, creates directory structure, returns info.
 */
export async function createSession() {
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = sessionDir(sessionId);

  await fs.mkdir(path.join(dir, 'input', 'model'), { recursive: true });
  await fs.mkdir(path.join(dir, 'input', 'clothes'), { recursive: true });
  await fs.mkdir(path.join(dir, 'input', 'detail-refs'), { recursive: true });
  await fs.mkdir(path.join(dir, 'step1'), { recursive: true });
  await fs.mkdir(path.join(dir, 'step2'), { recursive: true });
  await fs.mkdir(path.join(dir, 'final'), { recursive: true });

  const initialState = {
    sessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'uploading', // uploading | step1_done | step2_done | finished
    modelFront: null,
    modelBack: null,
    clothesGroups: [],
    additionalNotes: '',
    step1Results: [],
    detailRefs: [],
    step2Results: [],
    finalPath: null,
  };

  await saveSession(sessionId, initialState);
  return initialState;
}

/**
 * Save session state to meta.json.
 */
export async function saveSession(sessionId, sessionState) {
  sessionState.updatedAt = new Date().toISOString();
  const filePath = metaPath(sessionId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(sessionState, null, 2));
}

/**
 * Load session state from meta.json, resolving relative paths to absolute.
 */
export async function loadSession(sessionId) {
  const filePath = metaPath(sessionId);
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * List all sessions, sorted by most recent first.
 */
export async function listSessions() {
  const dir = sessionsDir();
  try {
    await fs.access(dir);
  } catch {
    return [];
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const sessions = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const state = await loadSession(entry.name);
      sessions.push({
        sessionId: state.sessionId,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        status: state.status,
        groupCount: state.clothesGroups?.length || 0,
      });
    } catch {
      // skip corrupted sessions
    }
  }

  sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return sessions;
}

/**
 * Delete a session and all its files.
 */
export async function deleteSession(sessionId) {
  const dir = sessionDir(sessionId);
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Get the base directory for a session.
 */
export function getSessionDir(sessionId) {
  return sessionDir(sessionId);
}
