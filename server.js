'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo'
};

function loadConfig(configPath) {
  let targetPath = configPath;
  if (!fs.existsSync(targetPath)) {
    const examplePath = path.join(path.dirname(configPath), 'config.example.json');
    if (fs.existsSync(examplePath)) {
      targetPath = examplePath;
    } else {
      return {
        port: 38421,
        folders: { sfwImages: '', nsfwImages: '', nsfwVideos: '' },
        imageExtensions: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']),
        videoExtensions: new Set(['.mp4', '.webm', '.mov']),
        maxHistory: 5,
        defaultIntervalSeconds: 10
      };
    }
  }
  const raw = fs.readFileSync(targetPath, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    port: parsed.port !== undefined && parsed.port !== null ? Number(parsed.port) : 38421,
    folders: {
      sfwImages: parsed.folders?.sfwImages || '',
      nsfwImages: parsed.folders?.nsfwImages || '',
      nsfwVideos: parsed.folders?.nsfwVideos || ''
    },
    imageExtensions: new Set((parsed.imageExtensions || ['.jpg', '.jpeg', '.png', '.webp', '.gif']).map((e) => e.toLowerCase())),
    videoExtensions: new Set((parsed.videoExtensions || ['.mp4', '.webm', '.mov']).map((e) => e.toLowerCase())),
    maxHistory: Math.max(1, Number(parsed.maxHistory) || 5),
    defaultIntervalSeconds: Math.max(1, Number(parsed.defaultIntervalSeconds) || 10)
  };
}

function makeFileId(filePath) {
  return crypto.createHash('sha1').update(filePath.toLowerCase()).digest('hex').slice(0, 16);
}

function createWallpaperApp(options = {}) {
  const configPath = options.configPath || process.env.FONDOS_CONFIG_PATH || path.join(ROOT_DIR, 'config.json');
  const statePath = options.statePath || process.env.FONDOS_STATE_PATH || path.join(ROOT_DIR, 'state.json');
  let config = loadConfig(configPath);

  const BOOT_ID = crypto.randomUUID();
  let nonceSeq = 1;
  let mediaCache = { signature: '', sfwImages: [], nsfwImages: [], nsfwVideos: [], byId: new Map() };
  const sseClients = new Set();

  function getStatMtime(targetPath) {
    if (!targetPath) return -1;
    try {
      return fs.statSync(targetPath).mtimeMs;
    } catch (_) {
      return -1;
    }
  }

  function scanFolder(dirPath, allowedExts, type) {
    if (!dirPath) return [];
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const items = [];
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!allowedExts.has(ext)) continue;
        const fullPath = path.join(dirPath, entry.name);
        const id = makeFileId(fullPath);
        items.push({
          fileId: id,
          name: entry.name,
          path: fullPath,
          ext,
          type,
          url: `/media/${id}${ext}`
        });
      }
      return items;
    } catch (_) {
      return [];
    }
  }

  function getMediaCatalog(force = false) {
    const cfgMtime = getStatMtime(configPath);
    if (force || cfgMtime !== mediaCache.cfgMtime) {
      try {
        config = loadConfig(configPath);
      } catch (_) {}
    }

    const sig = [
      cfgMtime,
      getStatMtime(config.folders.sfwImages),
      getStatMtime(config.folders.nsfwImages),
      getStatMtime(config.folders.nsfwVideos)
    ].join('|');

    if (!force && sig === mediaCache.signature) {
      return mediaCache;
    }

    const sfwImages = scanFolder(config.folders.sfwImages, config.imageExtensions, 'image');
    const nsfwImages = scanFolder(config.folders.nsfwImages, config.imageExtensions, 'image');
    const nsfwVideos = scanFolder(config.folders.nsfwVideos, config.videoExtensions, 'video');
    const byId = new Map();
    for (const item of [...sfwImages, ...nsfwImages, ...nsfwVideos]) {
      byId.set(item.fileId, item);
    }
    mediaCache = { signature: sig, cfgMtime, sfwImages, nsfwImages, nsfwVideos, byId };
    return mediaCache;
  }

  function defaultScreen(id, overrides = {}) {
    return {
      id,
      left: overrides.left ?? null,
      top: overrides.top ?? null,
      width: overrides.width ?? 0,
      height: overrides.height ?? 0,
      paused: Boolean(overrides.paused),
      filter: ['mixto', 'images', 'videos'].includes(overrides.filter) ? overrides.filter : 'mixto',
      muted: true,
      currentItem: overrides.currentItem || null,
      history: Array.isArray(overrides.history) ? overrides.history : [],
      replayQueue: [],
      replayCurrentUid: null
    };
  }

  function loadPersistedState() {
    const fallback = {
      contentMode: 'sfw',
      layoutMode: 'independiente',
      intervalSeconds: config.defaultIntervalSeconds,
      duplicateFilter: 'mixto',
      duplicateReplayQueue: [],
      duplicateReplayUid: null,
      screens: { P1: defaultScreen('P1') }
    };

    try {
      if (!fs.existsSync(statePath)) return fallback;
      const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const contentMode = saved.contentMode === 'nsfw' ? 'nsfw' : 'sfw';
      const catalog = getMediaCatalog(true);

      const normalizeHistory = (list) => (Array.isArray(list)
        ? list
            .filter((h) => h && h.mode === contentMode && h.fileId && catalog.byId.has(h.fileId))
            .slice(-config.maxHistory)
            .map((h) => {
              const live = catalog.byId.get(h.fileId);
              return {
                uid: h.uid || crypto.randomUUID(),
                fileId: live.fileId,
                name: live.name,
                path: live.path,
                url: live.url,
                type: live.type,
                mode: contentMode,
                shownAt: h.shownAt || Date.now()
              };
            })
        : []);

      const legacyHistory = Array.isArray(saved.history) ? saved.history : [];
      const screens = {};
      if (saved.screens && typeof saved.screens === 'object') {
        for (const [id, sc] of Object.entries(saved.screens)) {
          if (!/^P[12]$/.test(id)) continue;
          const rawHist = Array.isArray(sc.history)
            ? sc.history
            : legacyHistory.filter((h) => h && h.sourceScreen === id);
          const scHistory = normalizeHistory(rawHist);

          let restoredItem = null;
          if (sc.currentFileId && sc.currentMode === contentMode && catalog.byId.has(sc.currentFileId)) {
            const live = catalog.byId.get(sc.currentFileId);
            let historyUid = null;
            for (let i = scHistory.length - 1; i >= 0; i--) {
              if (scHistory[i].fileId === live.fileId) {
                historyUid = scHistory[i].uid;
                break;
              }
            }
            restoredItem = {
              historyUid,
              fileId: live.fileId,
              name: live.name,
              path: live.path,
              url: live.url,
              type: live.type,
              mode: contentMode,
              seed: Math.random(),
              nonce: nonceSeq++
            };
          }
          screens[id] = defaultScreen(id, { ...sc, currentItem: restoredItem, history: scHistory });
        }
      }
      if (!screens.P1) screens.P1 = defaultScreen('P1');

      return {
        contentMode,
        layoutMode: saved.layoutMode === 'duplicado' ? 'duplicado' : 'independiente',
        intervalSeconds: Math.max(1, Number(saved.intervalSeconds) || config.defaultIntervalSeconds),
        duplicateFilter: ['mixto', 'images', 'videos'].includes(saved.duplicateFilter) ? saved.duplicateFilter : 'mixto',
        duplicateReplayQueue: [],
        duplicateReplayUid: null,
        screens
      };
    } catch (_) {
      return fallback;
    }
  }

  const state = loadPersistedState();
  let remainingSeconds = state.intervalSeconds;

  function saveState() {
    const serializableScreens = {};
    for (const [id, sc] of Object.entries(state.screens)) {
      serializableScreens[id] = {
        id: sc.id,
        left: sc.left,
        top: sc.top,
        width: sc.width,
        height: sc.height,
        paused: sc.paused,
        filter: sc.filter,
        currentFileId: sc.currentItem?.fileId || null,
        currentMode: sc.currentItem?.mode || null,
        history: sc.history
      };
    }
    const payload = {
      contentMode: state.contentMode,
      layoutMode: state.layoutMode,
      intervalSeconds: state.intervalSeconds,
      duplicateFilter: state.duplicateFilter,
      screens: serializableScreens
    };
    try {
      fs.writeFileSync(statePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (_) {}
  }

  function getPool(mode, filter) {
    const catalog = getMediaCatalog();
    if (mode === 'sfw') {
      return catalog.sfwImages;
    }
    if (filter === 'images') return catalog.nsfwImages;
    if (filter === 'videos') return catalog.nsfwVideos;
    return [...catalog.nsfwImages, ...catalog.nsfwVideos];
  }

  function pickRandomItem(mode, filter, avoidPath) {
    const pool = getPool(mode, filter);
    if (pool.length === 0) return null;
    const candidates = pool.length > 1 && avoidPath ? pool.filter((f) => f.path !== avoidPath) : pool;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    return {
      fileId: chosen.fileId,
      name: chosen.name,
      path: chosen.path,
      url: chosen.url,
      type: chosen.type,
      mode,
      seed: Math.random(),
      nonce: nonceSeq++
    };
  }

  function makeItemFromHistory(entry) {
    const catalog = getMediaCatalog();
    const live = catalog.byId.get(entry.fileId);
    const base = live || entry;
    if (!fs.existsSync(base.path)) return null;
    return {
      historyUid: entry.uid,
      fileId: base.fileId,
      name: base.name,
      path: base.path,
      url: base.url,
      type: base.type,
      mode: state.contentMode,
      seed: Math.random(),
      nonce: nonceSeq++
    };
  }

  function pushHistory(screen, item) {
    if (!screen || !item) return item;
    const uid = crypto.randomUUID();
    const recorded = { ...item, historyUid: uid };
    screen.history.push({
      uid,
      fileId: recorded.fileId,
      name: recorded.name,
      path: recorded.path,
      url: recorded.url,
      type: recorded.type,
      mode: recorded.mode,
      shownAt: Date.now()
    });
    while (screen.history.length > config.maxHistory) {
      screen.history.shift();
    }
    return recorded;
  }

  function hasWallpaperClient(screenId) {
    for (const c of sseClients) {
      if (c.screenId === screenId && c.isWallpaper) return true;
    }
    return false;
  }

  function isOccupiedByOtherWallpaper(screenId, clientUid) {
    if (!clientUid) return false;
    for (const c of sseClients) {
      if (c.screenId === screenId && c.isWallpaper && c.clientUid !== clientUid) {
        return true;
      }
    }
    return false;
  }

  function resolveScreenId(geom = {}) {
    if (geom.explicitId && /^P\d+$/.test(geom.explicitId)) {
      if (!state.screens[geom.explicitId]) {
        state.screens[geom.explicitId] = defaultScreen(geom.explicitId);
        ensureInitialMediaForScreen(state.screens[geom.explicitId]);
      }
      return geom.explicitId;
    }

    const isWallpaper = geom.isWallpaper !== false;
    if (!isWallpaper) {
      return 'P1';
    }

    const parseCoord = (v) => (v !== null && v !== undefined && v !== '' ? Number(v) : NaN);
    const left = parseCoord(geom.left);
    const top = parseCoord(geom.top);
    const width = Number(geom.width) || 0;
    const height = Number(geom.height) || 0;
    const clientUid = geom.clientUid || '';
    const hasCoords = Number.isFinite(left) && Number.isFinite(top);

    const ordered = Object.values(state.screens).sort((a, b) => (Number(a.id.slice(1)) || 999) - (Number(b.id.slice(1)) || 999));

    if (width > 0 && height > 0) {
      for (const sc of ordered) {
        if (sc.width !== width || sc.height !== height) continue;
        const coordsMatch = sc.left === null || !hasCoords || (sc.left === left && sc.top === top);
        if (coordsMatch && !isOccupiedByOtherWallpaper(sc.id, clientUid)) {
          if (hasCoords) {
            sc.left = left;
            sc.top = top;
          }
          return sc.id;
        }
      }
    }

    for (const sc of ordered) {
      if (sc.width === 0 && sc.height === 0 && !isOccupiedByOtherWallpaper(sc.id, clientUid)) {
        if (hasCoords) {
          sc.left = left;
          sc.top = top;
        }
        if (width > 0 && height > 0) {
          sc.width = width;
          sc.height = height;
        }
        return sc.id;
      }
    }

    // Reuse an offline screen slot when a monitor resolution changed
    if (clientUid) {
      for (const sc of ordered) {
        if (!hasWallpaperClient(sc.id)) {
          if (hasCoords) {
            sc.left = left;
            sc.top = top;
          }
          if (width > 0 && height > 0) {
            sc.width = width;
            sc.height = height;
          }
          return sc.id;
        }
      }
    }

    let idx = 2;
    while (state.screens[`P${idx}`]) idx++;
    const newId = `P${idx}`;
    const newScreen = defaultScreen(newId, {
      left: hasCoords ? left : null,
      top: hasCoords ? top : null,
      width,
      height
    });
    state.screens[newId] = newScreen;
    ensureInitialMediaForScreen(newScreen);
    saveState();
    return newId;
  }

  function ensureInitialMediaForScreen(screen) {
    if (screen.currentItem) return;
    if (state.layoutMode === 'duplicado') {
      const ref = Object.values(state.screens).find((s) => s.currentItem);
      if (ref) {
        screen.currentItem = { ...ref.currentItem, nonce: nonceSeq++ };
        return;
      }
    }
    const item = pickRandomItem(state.contentMode, screen.filter, null);
    if (item) {
      screen.currentItem = pushHistory(screen, item);
    }
  }

  function advanceDuplicate(screensToUpdate, { recordHistory = true } = {}) {
    const activeScreens = screensToUpdate.filter((s) => s);
    if (activeScreens.length === 0) return;

    let item = null;
    while (state.duplicateReplayQueue.length > 0 && !item) {
      const nextEntry = state.duplicateReplayQueue.shift();
      const candidate = makeItemFromHistory(nextEntry);
      if (candidate) {
        state.duplicateReplayUid = nextEntry.uid;
        item = candidate;
      }
    }

    if (item) {
      for (const sc of activeScreens) {
        sc.replayCurrentUid = state.duplicateReplayUid;
        sc.replayQueue = state.duplicateReplayQueue.map((h) => ({ ...h }));
        sc.currentItem = { ...item, nonce: nonceSeq++ };
      }
      return;
    }

    state.duplicateReplayUid = null;
    const avoid = activeScreens[0].currentItem?.path || null;
    const baseItem = pickRandomItem(state.contentMode, state.duplicateFilter, avoid);
    for (const sc of activeScreens) {
      sc.replayCurrentUid = null;
      sc.replayQueue = [];
      if (!baseItem) {
        sc.currentItem = null;
      } else {
        const cloned = { ...baseItem, nonce: nonceSeq++ };
        sc.currentItem = recordHistory ? pushHistory(sc, cloned) : cloned;
      }
    }
  }

  function advanceSingleScreen(screen, { recordHistory = true } = {}) {
    let item = null;
    while (screen.replayQueue.length > 0 && !item) {
      const nextEntry = screen.replayQueue.shift();
      const candidate = makeItemFromHistory(nextEntry);
      if (candidate) {
        screen.replayCurrentUid = nextEntry.uid;
        item = candidate;
      }
    }

    if (!item) {
      screen.replayCurrentUid = null;
      const picked = pickRandomItem(state.contentMode, screen.filter, screen.currentItem?.path || null);
      item = picked && recordHistory ? pushHistory(screen, picked) : picked;
    }

    screen.currentItem = item;
  }

  function advanceTick() {
    const allScreens = Object.values(state.screens);
    const active = allScreens.filter((s) => !s.paused);
    if (active.length === 0) return;

    if (state.layoutMode === 'duplicado') {
      advanceDuplicate(active, { recordHistory: true });
    } else {
      for (const sc of active) {
        advanceSingleScreen(sc, { recordHistory: true });
      }
    }
    saveState();
  }

  function stepPrevious(screenId) {
    const screen = state.screens[screenId] || state.screens.P1;
    if (!screen || screen.history.length === 0) return;

    const activeUid = state.layoutMode === 'duplicado' ? state.duplicateReplayUid : screen.replayCurrentUid;
    let foundIdx = activeUid ? screen.history.findIndex((h) => h.uid === activeUid) : -1;
    if (foundIdx === -1) {
      const currentUid = screen.currentItem?.historyUid;
      if (currentUid) foundIdx = screen.history.findIndex((h) => h.uid === currentUid);
    }
    if (foundIdx === -1) {
      const currentPath = screen.currentItem?.path;
      for (let i = screen.history.length - 1; i >= 0; i--) {
        if (screen.history[i].path === currentPath) {
          foundIdx = i;
          break;
        }
      }
    }

    const targetIdx = foundIdx > 0
      ? foundIdx - 1
      : (foundIdx === 0 ? 0 : Math.max(0, screen.history.length - 2));

    showHistoryEntry(screen.history[targetIdx].uid, screen.id);
  }

  function showHistoryEntry(uid, targetScreenId) {
    const sc = state.screens[targetScreenId] || state.screens.P1;
    if (!sc) return false;
    let owner = sc;
    let idx = sc.history.findIndex((h) => h.uid === uid);
    if (idx === -1) {
      for (const other of Object.values(state.screens)) {
        const found = other.history.findIndex((h) => h.uid === uid);
        if (found !== -1) {
          owner = other;
          idx = found;
          break;
        }
      }
    }
    if (idx === -1) return false;

    const entry = owner.history[idx];
    const item = makeItemFromHistory(entry);
    if (!item) return false;

    const remaining = owner.history.slice(idx + 1).map((h) => ({ ...h }));

    if (state.layoutMode === 'duplicado') {
      state.duplicateReplayQueue = remaining;
      state.duplicateReplayUid = entry.uid;
      for (const each of Object.values(state.screens)) {
        each.replayQueue = remaining.map((h) => ({ ...h }));
        each.replayCurrentUid = entry.uid;
        each.currentItem = { ...item, nonce: nonceSeq++ };
      }
    } else {
      sc.replayQueue = remaining;
      sc.replayCurrentUid = entry.uid;
      sc.currentItem = item;
    }
    remainingSeconds = state.intervalSeconds;
    return true;
  }

  function getConnectedCounts() {
    const counts = {};
    for (const client of sseClients) {
      if (client.screenId) {
        counts[client.screenId] = (counts[client.screenId] || 0) + 1;
      }
    }
    return counts;
  }

  function getPublicState() {
    const catalog = getMediaCatalog();
    const online = getConnectedCounts();
    const orderedIds = Object.keys(state.screens).sort((a, b) => {
      const na = Number(a.slice(1)) || 999;
      const nb = Number(b.slice(1)) || 999;
      return na - nb;
    });

    const screens = {};
    for (const id of orderedIds) {
      const sc = state.screens[id];
      screens[id] = {
        id: sc.id,
        width: sc.width,
        height: sc.height,
        online: Boolean(online[id]),
        paused: sc.paused,
        filter: sc.filter,
        muted: sc.muted,
        currentItem: sc.currentItem,
        replayCurrentUid: sc.replayCurrentUid,
        replayRemaining: sc.replayQueue.length,
        replaying: Boolean(sc.replayCurrentUid) || sc.replayQueue.length > 0,
        historyLength: sc.history.length,
        history: sc.history.map((h, index) => ({
          uid: h.uid,
          index,
          name: h.name,
          url: h.url,
          type: h.type,
          mode: h.mode
        }))
      };
    }

    return {
      contentMode: state.contentMode,
      layoutMode: state.layoutMode,
      intervalSeconds: state.intervalSeconds,
      remainingSeconds,
      duplicateFilter: state.duplicateFilter,
      counts: {
        sfwImages: catalog.sfwImages.length,
        nsfwImages: catalog.nsfwImages.length,
        nsfwVideos: catalog.nsfwVideos.length
      },
      screens
    };
  }

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.res.write(payload);
      } catch (_) {
        sseClients.delete(client);
      }
    }
  }

  function broadcastState() {
    broadcast('state', getPublicState());
  }

  // Initialize starting media
  getMediaCatalog(true);
  if (state.layoutMode === 'duplicado') {
    const ref = Object.values(state.screens).find((s) => s.currentItem);
    if (ref) {
      for (const sc of Object.values(state.screens)) {
        if (!sc.currentItem) {
          const cloned = { ...ref.currentItem, nonce: nonceSeq++ };
          sc.currentItem = sc.history.length === 0 ? pushHistory(sc, cloned) : cloned;
        }
      }
    } else {
      advanceDuplicate(Object.values(state.screens), { recordHistory: true });
    }
  } else {
    for (const sc of Object.values(state.screens)) {
      ensureInitialMediaForScreen(sc);
    }
  }
  saveState();

  const timerHandle = setInterval(() => {
    const hasAutoAdvancing = Object.values(state.screens).some((s) => !s.paused);
    if (!hasAutoAdvancing) return;

    remainingSeconds -= 1;
    if (remainingSeconds <= 0) {
      remainingSeconds = state.intervalSeconds;
      advanceTick();
      broadcastState();
    } else {
      broadcast('tick', { remainingSeconds, intervalSeconds: state.intervalSeconds });
    }
  }, 1000);
  timerHandle.unref();

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1024 * 64) {
          reject(new Error('Body too large'));
          req.destroy();
        }
      });
      req.on('end', () => {
        if (!body) return resolve({});
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });
  }

  function sendJson(res, status, data) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(data));
  }

  function serveStatic(res, filePath) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return false;
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store'
      });
      const stream = fs.createReadStream(filePath);
      res.on('close', () => stream.destroy());
      stream.pipe(res);
      return true;
    } catch (_) {
      return false;
    }
  }

  function serveMedia(req, res, fileId) {
    const catalog = getMediaCatalog();
    const record = catalog.byId.get(fileId);
    if (!record || !fs.existsSync(record.path)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const stat = fs.statSync(record.path);
    const total = stat.size;
    const contentType = MIME_TYPES[record.ext] || 'application/octet-stream';
    const range = req.headers.range;

    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      if (!match) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        res.end();
        return;
      }
      const start = Math.min(Number(match[1]), total - 1);
      const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        res.end();
        return;
      }

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
      });
      if (req.method === 'HEAD') return res.end();
      const stream = fs.createReadStream(record.path, { start, end });
      res.on('close', () => stream.destroy());
      stream.pipe(res);
      return;
    }

    res.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': total,
      'Content-Type': contentType,
      'Cache-Control': 'no-store'
    });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(record.path);
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://127.0.0.1:${config.port}`);
    const pathname = parsedUrl.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      return res.end();
    }

    if (pathname === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/state' && req.method === 'GET') {
      return sendJson(res, 200, getPublicState());
    }

    if (pathname === '/events' && req.method === 'GET') {
      const clientUid = parsedUrl.searchParams.get('clientUid') || '';
      const isWallpaper = parsedUrl.searchParams.get('wallpaper') !== '0';
      const screenId = resolveScreenId({
        explicitId: parsedUrl.searchParams.get('screen'),
        clientUid,
        isWallpaper,
        left: parsedUrl.searchParams.get('left'),
        top: parsedUrl.searchParams.get('top'),
        width: parsedUrl.searchParams.get('width'),
        height: parsedUrl.searchParams.get('height')
      });

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      const client = { res, screenId, clientUid, isWallpaper };
      sseClients.add(client);

      res.write(`event: hello\ndata: ${JSON.stringify({ assignedScreenId: screenId, bootId: BOOT_ID })}\n\n`);
      broadcastState();

      const keepAlive = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch (_) {
          clearInterval(keepAlive);
          sseClients.delete(client);
        }
      }, 20000);

      req.on('close', () => {
        clearInterval(keepAlive);
        sseClients.delete(client);
        if (!/^P[12]$/.test(screenId) && !hasWallpaperClient(screenId)) {
          delete state.screens[screenId];
        }
        broadcastState();
      });
      return;
    }

    if (pathname.startsWith('/media/')) {
      const filePart = pathname.slice('/media/'.length);
      const fileId = filePart.split('.')[0];
      return serveMedia(req, res, fileId);
    }

    if (pathname.startsWith('/api/') && req.method === 'POST') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (_) {
        return sendJson(res, 400, { error: 'JSON inválido' });
      }

      if (pathname === '/api/register-screen') {
        const screenId = resolveScreenId(body);
        saveState();
        broadcastState();
        return sendJson(res, 200, { screenId, state: getPublicState() });
      }

      if (pathname === '/api/settings') {
        if (body.contentMode === 'sfw' || body.contentMode === 'nsfw') {
          if (body.contentMode !== state.contentMode) {
            state.contentMode = body.contentMode;
            state.duplicateReplayQueue = [];
            state.duplicateReplayUid = null;
            remainingSeconds = state.intervalSeconds;
            for (const sc of Object.values(state.screens)) {
              sc.history = [];
              sc.replayQueue = [];
              sc.replayCurrentUid = null;
            }
            if (state.layoutMode === 'duplicado') {
              advanceDuplicate(Object.values(state.screens), { recordHistory: true });
            } else {
              for (const sc of Object.values(state.screens)) {
                advanceSingleScreen(sc, { recordHistory: true });
              }
            }
          }
        }

        if (body.layoutMode === 'duplicado' || body.layoutMode === 'independiente') {
          if (body.layoutMode !== state.layoutMode) {
            state.layoutMode = body.layoutMode;
            state.duplicateReplayQueue = [];
            state.duplicateReplayUid = null;
            for (const sc of Object.values(state.screens)) {
              sc.replayQueue = [];
              sc.replayCurrentUid = null;
            }
            if (state.layoutMode === 'duplicado') {
              advanceDuplicate(Object.values(state.screens), { recordHistory: true });
              remainingSeconds = state.intervalSeconds;
            }
          }
        }

        if (body.intervalSeconds !== undefined) {
          const secs = Math.floor(Number(body.intervalSeconds));
          if (Number.isFinite(secs) && secs >= 1 && secs <= 86400) {
            state.intervalSeconds = secs;
            remainingSeconds = secs;
          }
        }

        if (['mixto', 'images', 'videos'].includes(body.duplicateFilter)) {
          state.duplicateFilter = body.duplicateFilter;
        }

        saveState();
        broadcastState();
        return sendJson(res, 200, getPublicState());
      }

      if (pathname === '/api/screen') {
        const sc = state.screens[body.screenId];
        if (!sc) return sendJson(res, 404, { error: 'Pantalla no encontrada' });

        if (typeof body.paused === 'boolean') sc.paused = body.paused;
        if (typeof body.muted === 'boolean') sc.muted = body.muted;
        if (['mixto', 'images', 'videos'].includes(body.filter)) {
          sc.filter = body.filter;
          if (state.layoutMode === 'duplicado') {
            state.duplicateFilter = body.filter;
          }
        }

        saveState();
        broadcastState();
        return sendJson(res, 200, getPublicState());
      }

      if (pathname === '/api/action') {
        const action = body.action;
        const targetId = body.screenId || 'P1';
        const target = state.screens[targetId] || state.screens.P1;

        if (action === 'next') {
          if (state.layoutMode === 'duplicado') {
            advanceDuplicate(Object.values(state.screens), { recordHistory: true });
          } else {
            advanceSingleScreen(target, { recordHistory: true });
          }
          remainingSeconds = state.intervalSeconds;
        } else if (action === 'prev') {
          stepPrevious(target.id);
        } else if (action === 'next-all') {
          if (state.layoutMode === 'duplicado') {
            advanceDuplicate(Object.values(state.screens), { recordHistory: true });
          } else {
            for (const sc of Object.values(state.screens)) {
              if (!sc.paused) advanceSingleScreen(sc, { recordHistory: true });
            }
          }
          remainingSeconds = state.intervalSeconds;
        } else if (action === 'resume-live') {
          target.replayQueue = [];
          target.replayCurrentUid = null;
          if (state.layoutMode === 'duplicado') {
            state.duplicateReplayQueue = [];
            state.duplicateReplayUid = null;
          }
        } else if (action === 'report-error') {
          if (target.currentItem && target.currentItem.fileId === body.fileId) {
            if (state.layoutMode === 'duplicado') {
              advanceDuplicate(Object.values(state.screens), { recordHistory: false });
            } else {
              advanceSingleScreen(target, { recordHistory: false });
            }
          }
        }

        saveState();
        broadcastState();
        return sendJson(res, 200, getPublicState());
      }

      if (pathname === '/api/history/show') {
        const ok = showHistoryEntry(body.uid, body.screenId || 'P1');
        if (!ok) return sendJson(res, 404, { error: 'Registro no encontrado o archivo ausente' });
        saveState();
        broadcastState();
        return sendJson(res, 200, getPublicState());
      }

      if (pathname === '/api/open-url') {
        const urlStr = String(body.url || '');
        if (!/^https:\/\/www\.pixiv\.net\/en\/artworks\/\d+$/i.test(urlStr)) {
          return sendJson(res, 400, { error: 'URL no permitida' });
        }
        if (process.platform === 'win32') {
          // explorer.exe handles raw https URLs by opening the default browser in Windows
          exec(`explorer.exe "${urlStr}"`);
        }
        return sendJson(res, 200, { ok: true, opened: urlStr });
      }

      if (pathname === '/api/reveal') {
        let entry = null;
        if (body.uid) {
          for (const sc of Object.values(state.screens)) {
            entry = sc.history.find((h) => h.uid === body.uid);
            if (entry) break;
          }
        }
        const catalog = getMediaCatalog();
        const fileRecord = entry || (body.fileId ? catalog.byId.get(body.fileId) : null);
        if (!fileRecord || !fs.existsSync(fileRecord.path)) {
          return sendJson(res, 404, { error: 'Archivo no encontrado en disco' });
        }
        const cleanPath = path.resolve(fileRecord.path).replace(/"/g, '');
        if (process.platform === 'win32') {
          exec(`explorer.exe /select,"${cleanPath}"`);
        }
        return sendJson(res, 200, { ok: true, revealed: cleanPath });
      }

      return sendJson(res, 404, { error: 'Ruta API desconocida' });
    }

    if (req.method === 'GET') {
      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const resolved = path.resolve(PUBLIC_DIR, rel);
      if (resolved.startsWith(PUBLIC_DIR) && serveStatic(res, resolved)) {
        return;
      }
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return {
    server,
    config,
    state,
    getPublicState,
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve(server.address());
        });
      });
    },
    stop() {
      clearInterval(timerHandle);
      for (const client of sseClients) {
        try {
          client.res.end();
        } catch (_) {}
      }
      sseClients.clear();
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

if (require.main === module) {
  const app = createWallpaperApp();
  app.start().then((addr) => {
    console.log(`Servidor de fondos escuchando en http://127.0.0.1:${addr.port}`);
  });
}

module.exports = { createWallpaperApp };
