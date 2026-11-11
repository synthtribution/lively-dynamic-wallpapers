'use strict';

(() => {
  const params = new URLSearchParams(window.location.search);
  const explicitScreen = params.get('screen');

  const layers = [document.getElementById('layer-0'), document.getElementById('layer-1')];
  let activeLayerIdx = 0;
  let currentRenderedNonce = null;
  let activeVideoEl = null;
  let bgRafId = null;

  let myScreenId = explicitScreen || 'P1';
  let knownBootId = null;
  let appState = null;
  let mainView = 'screens'; // 'screens' | 'history'
  let selectedScreenTab = null;
  let historyTargetId = null;
  let historyRenderedOnce = false;
  let hudPinned = false;
  let closeTimer = null;
  let lastErrorReportedAt = 0;

  const hudWrap = document.getElementById('hud-wrap');
  const hudPanel = document.getElementById('hud-panel');
  const hudPill = document.getElementById('hud-pill');
  const pillModeDot = document.getElementById('pill-mode-dot');
  const pillLabel = document.getElementById('pill-label');

  const btnSfw = document.getElementById('btn-mode-sfw');
  const btnNsfw = document.getElementById('btn-mode-nsfw');
  const btnDup = document.getElementById('btn-layout-dup');
  const btnInd = document.getElementById('btn-layout-ind');
  const btnPinHud = document.getElementById('btn-pin-hud');

  const inputSeconds = document.getElementById('input-seconds');
  const btnSecMinus = document.getElementById('btn-sec-minus');
  const btnSecPlus = document.getElementById('btn-sec-plus');
  const countdownText = document.getElementById('countdown-text');
  const progressFill = document.getElementById('progress-fill');

  const mainTabScreens = document.getElementById('main-tab-screens');
  const mainTabHistory = document.getElementById('main-tab-history');
  const screenTabsBar = document.getElementById('screen-tabs-bar');
  const tabScreen = document.getElementById('tab-screen');
  const tabHistory = document.getElementById('tab-history');

  const scTypeBadge = document.getElementById('sc-type-badge');
  const scFileName = document.getElementById('sc-file-name');
  const scStatusText = document.getElementById('sc-status-text');
  const btnPrev = document.getElementById('btn-prev');
  const btnPause = document.getElementById('btn-pause');
  const btnNext = document.getElementById('btn-next');
  const btnMute = document.getElementById('btn-mute');
  const btnRevealCurrent = document.getElementById('btn-reveal-current');
  const filterRow = document.getElementById('filter-row');
  const btnResumeLive = document.getElementById('btn-resume-live');
  const btnHistoryResume = document.getElementById('btn-history-resume');

  const historyList = document.getElementById('history-list');
  const historyTargetWrap = document.getElementById('history-target-wrap');
  const historyTargetTabs = document.getElementById('history-target-tabs');

  const emptyBanner = document.getElementById('empty-banner');
  const emptyTitle = document.getElementById('empty-title');
  const emptySub = document.getElementById('empty-sub');

  async function api(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    if (!res.ok) return null;
    return res.json();
  }

  function getPixivUrl(filename) {
    if (!filename) return null;
    const m = filename.match(/^(\d{6,11})(?:-[a-f0-9]+)?_p\d+/i);
    return m ? `https://www.pixiv.net/en/artworks/${m[1]}` : null;
  }

  function openExternalUrl(url) {
    if (!url) return;
    api('/api/open-url', { url });
  }

  function formatFileNameElement(container, filename, defaultText = 'Sin archivo') {
    container.textContent = '';
    if (!filename) {
      container.textContent = defaultText;
      container.title = '';
      return;
    }
    const pixivUrl = getPixivUrl(filename);
    if (pixivUrl) {
      const a = document.createElement('a');
      a.className = 'pixiv-link';
      a.textContent = filename;
      a.href = pixivUrl;
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      a.title = `${filename}\nVer ilustración en Pixiv (${pixivUrl})`;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openExternalUrl(pixivUrl);
      });
      container.appendChild(a);
    } else {
      container.textContent = filename;
      container.title = filename;
    }
  }

  function getClientUid() {
    let uid = sessionStorage.getItem('fondosClientUid');
    if (!uid) {
      uid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('fondosClientUid', uid);
    }
    return uid;
  }

  function getScreenGeometry() {
    const left = typeof window.screen.availLeft === 'number' ? window.screen.availLeft : window.screenX;
    const top = typeof window.screen.availTop === 'number' ? window.screen.availTop : window.screenY;
    const vw = window.innerWidth || window.screen.width;
    const vh = window.innerHeight || window.screen.height;
    const ow = window.outerWidth || vw;
    const oh = window.outerHeight || vh;
    const isFrameless = Math.abs(ow - vw) <= 6 && Math.abs(oh - vh) <= 6;
    return {
      explicitId: explicitScreen || undefined,
      clientUid: getClientUid(),
      isWallpaper: params.get('wallpaper') === '1' || isFrameless,
      left,
      top,
      width: vw,
      height: vh
    };
  }

  function openHud() {
    clearTimeout(closeTimer);
    hudPanel.classList.remove('hidden');
    hudWrap.classList.add('open');
  }

  function scheduleCloseHud() {
    if (hudPinned) return;
    if (document.activeElement === inputSeconds) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!hudPinned) {
        hudPanel.classList.add('hidden');
        hudWrap.classList.remove('open');
        clearHistoryList();
      }
    }, 450);
  }

  hudWrap.addEventListener('mouseenter', openHud);
  hudWrap.addEventListener('mouseleave', scheduleCloseHud);
  hudPill.addEventListener('click', () => {
    if (hudPanel.classList.contains('hidden')) openHud();
    else {
      hudPinned = false;
      btnPinHud.classList.remove('active');
      hudPanel.classList.add('hidden');
      hudWrap.classList.remove('open');
      clearHistoryList();
    }
  });

  btnPinHud.addEventListener('click', () => {
    hudPinned = !hudPinned;
    btnPinHud.classList.toggle('active', hudPinned);
    if (hudPinned) openHud();
  });

  function stopVideoLoop() {
    if (bgRafId) {
      cancelAnimationFrame(bgRafId);
      bgRafId = null;
    }
  }

  function releaseMediaIn(rootEl) {
    const vids = rootEl.querySelectorAll('video');
    for (const v of vids) {
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch (_) {}
    }
  }

  function clearHistoryList() {
    historyRenderedOnce = false;
    releaseMediaIn(historyList);
    historyList.innerHTML = '';
  }

  function cleanupLayer(layerEl) {
    releaseMediaIn(layerEl);
    layerEl.innerHTML = '';
  }

  function reportBrokenMedia(fileId) {
    const now = Date.now();
    if (now - lastErrorReportedAt < 1500) return;
    lastErrorReportedAt = now;
    api('/api/action', { action: 'report-error', screenId: myScreenId, fileId });
  }

  function renderMedia(item, screenObj) {
    if (!item) {
      currentRenderedNonce = null;
      stopVideoLoop();
      activeVideoEl = null;
      layers.forEach((l) => {
        l.classList.remove('active');
        cleanupLayer(l);
      });
      emptyBanner.classList.remove('hidden');
      emptyTitle.textContent = appState?.contentMode === 'sfw'
        ? 'No hay imágenes en la carpeta SFW'
        : 'No hay archivos en las carpetas NSFW seleccionadas';
      emptySub.textContent = 'Revisa config.json o agrega imágenes/videos compatibles en la carpeta correspondiente.';
      return;
    }

    emptyBanner.classList.add('hidden');

    if (item.nonce === currentRenderedNonce) {
      if (activeVideoEl) {
        activeVideoEl.muted = Boolean(screenObj.muted);
      }
      return;
    }

    currentRenderedNonce = item.nonce;
    const nextIdx = activeLayerIdx === 0 ? 1 : 0;
    const nextLayer = layers[nextIdx];
    const prevLayer = layers[activeLayerIdx];
    cleanupLayer(nextLayer);

    const activateNext = () => {
      if (currentRenderedNonce !== item.nonce) return;
      nextLayer.classList.add('active');
      prevLayer.classList.remove('active');
      activeLayerIdx = nextIdx;
      setTimeout(() => {
        if (activeLayerIdx === nextIdx) cleanupLayer(prevLayer);
      }, 650);
    };

    if (item.type === 'image') {
      stopVideoLoop();
      activeVideoEl = null;

      const bgImg = document.createElement('img');
      bgImg.className = 'media-bg';
      bgImg.alt = '';
      bgImg.src = item.url;

      const fgImg = document.createElement('img');
      fgImg.className = 'media-fg';
      fgImg.alt = item.name;
      fgImg.src = item.url;

      fgImg.onload = () => {
        if (typeof fgImg.decode === 'function') {
          fgImg.decode().catch(() => {}).finally(activateNext);
        } else {
          activateNext();
        }
      };
      fgImg.onerror = () => reportBrokenMedia(item.fileId);

      nextLayer.append(bgImg, fgImg);
      return;
    }

    const canvasBg = document.createElement('canvas');
    canvasBg.className = 'media-bg';
    canvasBg.width = 48;
    canvasBg.height = 27;
    const ctx = canvasBg.getContext('2d', { alpha: false });

    const fgVid = document.createElement('video');
    fgVid.className = 'media-fg';
    fgVid.src = item.url;
    fgVid.muted = Boolean(screenObj.muted);
    fgVid.playsInline = true;
    fgVid.preload = 'auto';

    let activated = false;
    let lastDraw = 0;
    let seekFallbackTimer = null;

    const startBgDraw = () => {
      stopVideoLoop();
      const drawLoop = (ts) => {
        if (activeVideoEl !== fgVid) return;
        if (ts - lastDraw > 65 && fgVid.readyState >= 2) {
          lastDraw = ts;
          try {
            ctx.drawImage(fgVid, 0, 0, canvasBg.width, canvasBg.height);
          } catch (_) {}
        }
        bgRafId = requestAnimationFrame(drawLoop);
      };
      bgRafId = requestAnimationFrame(drawLoop);
    };

    const finishStart = () => {
      clearTimeout(seekFallbackTimer);
      if (activated || currentRenderedNonce !== item.nonce) return;
      activated = true;
      activeVideoEl = fgVid;
      fgVid.muted = Boolean(appState?.screens?.[myScreenId]?.muted ?? screenObj.muted);
      fgVid.play().catch(() => {
        fgVid.muted = true;
        fgVid.play().catch(() => {});
      });
      startBgDraw();
      activateNext();
    };

    fgVid.addEventListener('loadedmetadata', () => {
      if (currentRenderedNonce !== item.nonce) return;
      const interval = appState?.intervalSeconds || 10;
      const dur = Number.isFinite(fgVid.duration) ? fgVid.duration : 0;
      if (dur > 0 && dur <= interval) {
        fgVid.loop = true;
      }
      const maxStart = Math.max(0, dur - interval);
      const startAt = dur > interval
        ? item.seed * maxStart
        : (dur > 2 ? item.seed * Math.max(0, dur - 1.5) : 0);

      if (startAt > 0.05) {
        fgVid.addEventListener('seeked', finishStart, { once: true });
        fgVid.currentTime = startAt;
        seekFallbackTimer = setTimeout(finishStart, 850);
      } else {
        finishStart();
      }
    }, { once: true });

    fgVid.addEventListener('error', () => reportBrokenMedia(item.fileId), { once: true });

    nextLayer.append(canvasBg, fgVid);
  }

  function updateCountdown(remaining, total) {
    const safeTotal = Math.max(1, total || 10);
    const pct = Math.max(0, Math.min(100, (remaining / safeTotal) * 100));
    countdownText.textContent = `${remaining}s`;
    progressFill.style.width = `${pct}%`;

    const modeTag = appState?.contentMode === 'nsfw' ? 'NSFW' : 'SFW';
    pillLabel.textContent = `${modeTag} · ${myScreenId} · ${remaining}s`;
  }

  function getSelectedScreenId() {
    if (!appState) return myScreenId;
    if (selectedScreenTab && appState.screens[selectedScreenTab]) {
      return selectedScreenTab;
    }
    return myScreenId;
  }

  function buildScreenTabButtons(containerEl, screenIds, activeId, onSelect) {
    containerEl.innerHTML = '';
    for (const id of screenIds) {
      const sc = appState.screens[id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-btn' + (activeId === id ? ' active' : '');
      const resLabel = sc.width && sc.height ? ` ${sc.width}×${sc.height}` : '';
      const hereTag = id === myScreenId ? ' (Aquí)' : '';
      btn.innerHTML = `<span class="tab-dot ${sc.online ? 'online' : ''}"></span><span>${id}${resLabel}${hereTag}</span>`;
      btn.addEventListener('click', () => onSelect(id));
      containerEl.appendChild(btn);
    }
  }

  function renderHud() {
    if (!appState) return;
    const screenIds = Object.keys(appState.screens);
    const myScreen = appState.screens[myScreenId] || Object.values(appState.screens)[0];
    if (!myScreen) return;

    if (!selectedScreenTab || !appState.screens[selectedScreenTab]) {
      selectedScreenTab = myScreenId;
    }
    if (!historyTargetId || !appState.screens[historyTargetId]) {
      historyTargetId = myScreenId;
    }

    const isNsfw = appState.contentMode === 'nsfw';
    btnSfw.classList.toggle('active', !isNsfw);
    btnNsfw.classList.toggle('active', isNsfw);
    btnNsfw.classList.toggle('nsfw', isNsfw);
    pillModeDot.classList.toggle('nsfw', isNsfw);

    const isDup = appState.layoutMode === 'duplicado';
    btnDup.classList.toggle('active', isDup);
    btnInd.classList.toggle('active', !isDup);

    if (document.activeElement !== inputSeconds) {
      inputSeconds.value = String(appState.intervalSeconds);
    }
    updateCountdown(appState.remainingSeconds, appState.intervalSeconds);

    const histSource = appState.screens[isDup ? myScreenId : (historyTargetId || myScreenId)] || myScreen;
    const histCount = histSource?.history?.length || 0;
    mainTabScreens.classList.toggle('active', mainView === 'screens');
    mainTabHistory.classList.toggle('active', mainView === 'history');
    mainTabHistory.textContent = `🕘 Historial (${histCount})`;

    if (mainView === 'history') {
      tabScreen.classList.add('hidden');
      tabHistory.classList.remove('hidden');
      renderHistoryTab(screenIds);
      return;
    }

    tabHistory.classList.add('hidden');
    tabScreen.classList.remove('hidden');

    buildScreenTabButtons(screenTabsBar, screenIds, selectedScreenTab, (id) => {
      selectedScreenTab = id;
      renderHud();
    });

    const target = appState.screens[selectedScreenTab] || myScreen;
    const item = target.currentItem;

    if (item) {
      scTypeBadge.textContent = item.type === 'video' ? 'VID' : 'IMG';
      scTypeBadge.classList.toggle('video', item.type === 'video');
      formatFileNameElement(scFileName, item.name);
    } else {
      scTypeBadge.textContent = '—';
      scTypeBadge.classList.remove('video');
      formatFileNameElement(scFileName, null, 'Sin archivo');
    }

    const parts = [];
    parts.push(target.paused ? 'Pausado' : 'Rotando');
    if (target.replaying) {
      const rem = target.replayRemaining || 0;
      parts.push(rem > 0 ? `Historial (${rem} sig.)` : 'Historial (último)');
    }
    scStatusText.textContent = parts.join(' · ');

    btnPause.textContent = target.paused ? '▶ Reanudar' : '⏸ Pausar';
    btnPause.classList.toggle('warn-active', target.paused);

    btnMute.textContent = target.muted ? `🔇 Audio ${target.id}: Silenciado` : `🔊 Audio ${target.id}: Activo`;
    btnMute.classList.toggle('active', !target.muted);

    btnRevealCurrent.disabled = !item;

    filterRow.classList.toggle('hidden', !isNsfw);
    const activeFilter = isDup ? appState.duplicateFilter : target.filter;
    for (const fbtn of filterRow.querySelectorAll('[data-filter]')) {
      fbtn.classList.toggle('active', fbtn.dataset.filter === activeFilter);
    }

    btnResumeLive.classList.toggle('hidden', !target.replaying);
  }

  function renderHistoryTab(screenIds) {
    const isDup = appState.layoutMode === 'duplicado';
    historyTargetWrap.classList.toggle('hidden', isDup || screenIds.length <= 1);

    buildScreenTabButtons(historyTargetTabs, screenIds, historyTargetId, (id) => {
      if (historyTargetId !== id) {
        historyTargetId = id;
        clearHistoryList();
        renderHud();
      }
    });

    const targetId = isDup ? myScreenId : (historyTargetId || myScreenId);
    const targetScreen = appState.screens[targetId] || appState.screens[myScreenId];
    btnHistoryResume.classList.toggle('hidden', !targetScreen?.replaying);

    const entries = targetScreen?.history || [];
    if (entries.length === 0) {
      clearHistoryList();
      const empty = document.createElement('div');
      empty.className = 'muted-label';
      empty.textContent = 'Todavía no hay historial en este modo.';
      historyList.appendChild(empty);
      return;
    }

    // Most recent first (top), oldest last (bottom)
    const newestFirst = [...entries].sort((a, b) => (b.index - a.index));
    const validUids = new Set(newestFirst.map((e) => e.uid));

    const animateNew = historyRenderedOnce;
    const existingRows = new Map();
    const toExit = [];

    for (const child of Array.from(historyList.children)) {
      if (child.dataset?.exiting === '1') continue;
      const uid = child.dataset?.uid;
      if (uid && validUids.has(uid)) {
        existingRows.set(uid, child);
      } else if (animateNew && uid) {
        child.dataset.exiting = '1';
        toExit.push(child);
      } else {
        releaseMediaIn(child);
        child.remove();
      }
    }

    const currentUid = targetScreen?.currentItem?.historyUid || (targetScreen?.replaying ? targetScreen.replayCurrentUid : null);
    const toReveal = [];

    newestFirst.forEach((entry, posIdx) => {
      const isCurrent = entry.uid === currentUid;

      let row = existingRows.get(entry.uid);
      const isNewRow = !row;

      if (isNewRow) {
        row = document.createElement('div');
        row.dataset.uid = entry.uid;
        row.className = 'history-item' + (animateNew ? ' entering' : '');

        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'hist-thumb-wrap';

        if (entry.type === 'video') {
          const vid = document.createElement('video');
          vid.className = 'hist-thumb';
          vid.src = `${entry.url}#t=0.5`;
          vid.muted = true;
          vid.playsInline = true;
          vid.preload = 'metadata';
          const badge = document.createElement('span');
          badge.className = 'hist-thumb-badge';
          badge.textContent = '▶';
          thumbWrap.append(vid, badge);
        } else {
          const img = document.createElement('img');
          img.className = 'hist-thumb';
          img.src = entry.url;
          img.alt = '';
          img.loading = 'lazy';
          thumbWrap.appendChild(img);
        }

        const name = document.createElement('span');
        name.className = 'history-item-name';
        formatFileNameElement(name, entry.name);

        const btnFolder = document.createElement('button');
        btnFolder.type = 'button';
        btnFolder.className = 'hist-btn';
        btnFolder.textContent = '📂';
        btnFolder.title = 'Abrir en el Explorador de Windows';
        btnFolder.setAttribute('aria-label', 'Mostrar en carpeta');
        btnFolder.addEventListener('click', (e) => {
          e.stopPropagation();
          api('/api/reveal', { uid: entry.uid });
        });

        row.addEventListener('click', () => {
          const curTarget = appState?.layoutMode === 'duplicado' ? myScreenId : (historyTargetId || myScreenId);
          api('/api/history/show', {
            uid: entry.uid,
            screenId: curTarget
          });
        });

        row.append(thumbWrap, name, btnFolder);
      }

      row.classList.toggle('is-current', isCurrent);
      row.classList.toggle('replaying', Boolean(targetScreen?.replaying && targetScreen.replayCurrentUid === entry.uid));

      const refNode = historyList.children[posIdx] || null;
      if (refNode !== row) {
        historyList.insertBefore(row, refNode);
      }

      if (isNewRow && animateNew) {
        toReveal.push(row);
      }
    });

    historyRenderedOnce = true;

    if (toReveal.length > 0 || toExit.length > 0) {
      void historyList.offsetHeight;
      requestAnimationFrame(() => {
        for (const r of toReveal) {
          r.classList.remove('entering');
        }
        for (const ex of toExit) {
          ex.classList.add('exiting');
          setTimeout(() => {
            if (ex.isConnected) {
              releaseMediaIn(ex);
              ex.remove();
            }
          }, 360);
        }
      });
    }
  }

  mainTabScreens.addEventListener('click', () => {
    mainView = 'screens';
    clearHistoryList();
    renderHud();
  });
  mainTabHistory.addEventListener('click', () => {
    mainView = 'history';
    renderHud();
  });

  btnSfw.addEventListener('click', () => api('/api/settings', { contentMode: 'sfw' }));
  btnNsfw.addEventListener('click', () => api('/api/settings', { contentMode: 'nsfw' }));
  btnDup.addEventListener('click', () => api('/api/settings', { layoutMode: 'duplicado' }));
  btnInd.addEventListener('click', () => api('/api/settings', { layoutMode: 'independiente' }));

  function submitSeconds(val) {
    const parsed = Math.max(1, Math.min(86400, Math.floor(Number(val) || 10)));
    inputSeconds.value = String(parsed);
    api('/api/settings', { intervalSeconds: parsed });
  }

  btnSecMinus.addEventListener('click', () => submitSeconds((Number(inputSeconds.value) || 10) - 1));
  btnSecPlus.addEventListener('click', () => submitSeconds((Number(inputSeconds.value) || 10) + 1));
  inputSeconds.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      submitSeconds(inputSeconds.value);
      inputSeconds.blur();
    }
  });
  inputSeconds.addEventListener('change', () => submitSeconds(inputSeconds.value));
  inputSeconds.addEventListener('blur', scheduleCloseHud);

  btnPrev.addEventListener('click', () => {
    api('/api/action', { action: 'prev', screenId: getSelectedScreenId() });
  });
  btnNext.addEventListener('click', () => {
    api('/api/action', { action: 'next', screenId: getSelectedScreenId() });
  });
  btnPause.addEventListener('click', () => {
    const id = getSelectedScreenId();
    const sc = appState?.screens?.[id];
    if (sc) api('/api/screen', { screenId: id, paused: !sc.paused });
  });
  btnMute.addEventListener('click', () => {
    const id = getSelectedScreenId();
    const sc = appState?.screens?.[id];
    if (sc) api('/api/screen', { screenId: id, muted: !sc.muted });
  });
  btnRevealCurrent.addEventListener('click', () => {
    const id = getSelectedScreenId();
    const sc = appState?.screens?.[id];
    if (sc?.currentItem?.fileId) {
      api('/api/reveal', { fileId: sc.currentItem.fileId });
    }
  });
  btnResumeLive.addEventListener('click', () => {
    api('/api/action', { action: 'resume-live', screenId: getSelectedScreenId() });
  });
  btnHistoryResume.addEventListener('click', () => {
    const id = appState?.layoutMode === 'duplicado' ? myScreenId : (historyTargetId || myScreenId);
    api('/api/action', { action: 'resume-live', screenId: id });
  });

  for (const fbtn of filterRow.querySelectorAll('[data-filter]')) {
    fbtn.addEventListener('click', () => {
      const id = getSelectedScreenId();
      api('/api/screen', { screenId: id, filter: fbtn.dataset.filter });
    });
  }

  function connectSSE() {
    const geom = getScreenGeometry();
    const qs = new URLSearchParams();
    if (geom.explicitId) qs.set('screen', geom.explicitId);
    qs.set('clientUid', geom.clientUid);
    qs.set('wallpaper', geom.isWallpaper ? '1' : '0');
    if (Number.isFinite(geom.left)) qs.set('left', String(geom.left));
    if (Number.isFinite(geom.top)) qs.set('top', String(geom.top));
    qs.set('width', String(geom.width));
    qs.set('height', String(geom.height));

    const es = new EventSource(`/events?${qs.toString()}`);

    es.addEventListener('hello', (ev) => {
      const info = JSON.parse(ev.data);
      if (info.bootId) {
        if (knownBootId && knownBootId !== info.bootId) {
          window.location.reload();
          return;
        }
        knownBootId = info.bootId;
      }
      if (info.assignedScreenId) {
        myScreenId = info.assignedScreenId;
        if (!selectedScreenTab) selectedScreenTab = myScreenId;
        if (!historyTargetId) historyTargetId = myScreenId;
      }
    });

    es.addEventListener('state', (ev) => {
      appState = JSON.parse(ev.data);
      const myScreen = appState.screens[myScreenId] || Object.values(appState.screens)[0];
      if (myScreen) {
        renderMedia(myScreen.currentItem, myScreen);
      }
      renderHud();
    });

    es.addEventListener('tick', (ev) => {
      const data = JSON.parse(ev.data);
      if (appState) {
        appState.remainingSeconds = data.remainingSeconds;
        appState.intervalSeconds = data.intervalSeconds;
      }
      updateCountdown(data.remainingSeconds, data.intervalSeconds);
    });

    es.onerror = () => {
      es.close();
      setTimeout(connectSSE, 1500);
    };
  }

  connectSSE();
})();
