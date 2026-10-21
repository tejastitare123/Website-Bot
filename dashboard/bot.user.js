// ==UserScript==
// @name         TrendSearch Pro Bot
// @namespace    https://trendsearch-pro.vercel.app
// @version      2.0.0
// @description  Microsoft Rewards Bot — Full pipeline
// @author       BEAST
// @match        https://trendsearch-pro.vercel.app/*
// @match        https://*.vercel.app/*
// @match        https://localhost:*/*
// @match        https://rewards.bing.com/*
// @match        https://www.bing.com/*
// @match        https://bing.com/*
// @match        https://login.live.com/oauth20_desktop.srf*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @grant        GM_notification
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // SECTION 1 — CONFIG
  // ═══════════════════════════════════════════════════════════════
  const SERVER_BASE = 'https://news-proxy-gamma.vercel.app'; // ← APNA SERVER
  const LICENSE_URL = SERVER_BASE + '/api/license/verify';
  const OAUTH_URL = SERVER_BASE + '/api/oauth/exchange';
  const READ_EARN_URL = SERVER_BASE + '/api/rewards/read';      // ← VERIFY
  const CHECKIN_URL = SERVER_BASE + '/api/rewards/checkin';    // ← VERIFY
  const NEWS_URL = SERVER_BASE + '/api/news';

  const HOST = location.hostname;
  const IS_DASHBOARD = HOST.includes('vercel.app') || HOST.includes('localhost');
  const IS_OAUTH = HOST === 'login.live.com' && location.pathname.includes('oauth20_desktop');
  const IS_BOT = !IS_DASHBOARD && !IS_OAUTH && (HOST.includes('bing.com'));

  // ═══════════════════════════════════════════════════════════════
  // SECTION 2 — UTILITIES
  // ═══════════════════════════════════════════════════════════════
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function generateHex(len = 16) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function generateUUID() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function gmFetch(url, opts = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: opts.method || 'GET',
        url,
        headers: opts.headers || {},
        data: opts.body,
        timeout: 30000,
        onload: resolve,
        onerror: () => reject(new Error('Network error: ' + url)),
        ontimeout: () => reject(new Error('Timeout: ' + url))
      });
    });
  }

  function waitForDOM() {
    return new Promise((resolve) => {
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        resolve();
      } else {
        document.addEventListener('DOMContentLoaded', resolve, { once: true });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 3 — OAUTH CODE CATCHER (login.live.com)
  // ═══════════════════════════════════════════════════════════════
  if (IS_OAUTH) {
    try {
      const code = new URL(location.href).searchParams.get('code');
      if (code) {
        console.log('[TSP] OAuth code captured');
        gmFetch(OAUTH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        })
          .then((res) => {
            try {
              const json = JSON.parse(res.responseText);
              if (json.access_token) {
                GM_setValue('ts_token', { token: json.access_token, ts: Date.now() });
                console.log('[TSP] Token saved');
              }
            } catch (e) {
              console.error('[TSP] Token parse error', e);
            }
          })
          .catch((e) => console.error('[TSP] OAuth exchange failed', e));
      }
    } catch (e) {
      console.error('[TSP] OAuth error', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 4 — DASHBOARD BRIDGE
  // ═══════════════════════════════════════════════════════════════
  function initDashboardBridge() {
    console.log('[TSP] Dashboard bridge ready');
    window.postMessage({ type: 'EXT_BRIDGE_READY' }, '*');

    window.addEventListener('message', (e) => {
      if (e.source !== window) return;
      if (!e.data || e.data.type !== 'EXT_CALL') return;
      handleCommand(e.data.payload || {})
        .then((res) =>
          window.postMessage({ type: 'EXT_RESPONSE', id: e.data.id, response: res }, '*')
        )
        .catch((err) =>
          window.postMessage(
            { type: 'EXT_RESPONSE', id: e.data.id, error: err.message },
            '*'
          )
        );
    });

    GM_addValueChangeListener('ts_status', (n, oldV, newV, remote) => {
      if (remote && newV) window.postMessage({ type: 'EXT_PUSH', payload: { status: newV } }, '*');
    });

    GM_getValue('ts_status', null).then((s) => {
      if (s) window.postMessage({ type: 'EXT_PUSH', payload: { status: s } }, '*');
    });
  }

  async function handleCommand(payload) {
    const { action, ...data } = payload;

    if (action === 'getStatus') {
      const status = (await GM_getValue('ts_status', null)) || {};
      const license = await GM_getValue('ts_license', null);
      const token = await GM_getValue('ts_token', null);
      return { ...status, licenseActive: !!license, hasToken: !!token };
    }

    if (action === 'activateLicense') {
      if (!data.key) return { valid: false, reason: 'No key' };
      try {
        const res = await gmFetch(LICENSE_URL + '?key=' + encodeURIComponent(data.key));
        const json = JSON.parse(res.responseText);
        if (json.valid) {
          await GM_setValue('ts_license', data.key);
          return { valid: true };
        }
        return { valid: false, reason: json.reason || 'Invalid key' };
      } catch (e) {
        return { valid: false, reason: 'Server error' };
      }
    }

    if (action === 'startPipeline') {
      await GM_setValue('ts_config', data);
      // Reset pipeline state
      await GM_deleteValue('ts_pipeline');
      await GM_setValue('ts_cmd', { cmd: 'start', ts: Date.now() });
      GM_openInTab('https://rewards.bing.com/', { active: false, insert: true });
      return { started: true };
    }

    if (action === 'stop') {
      await GM_setValue('ts_cmd', { cmd: 'stop', ts: Date.now() });
      return { stopped: true };
    }

    if (action === 'updateConfig') {
      await GM_setValue('ts_config', data.config);
      return { updated: true };
    }

    throw new Error('Unknown action: ' + action);
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 5 — BOT ENGINE
  // ═══════════════════════════════════════════════════════════════
  let BOT_RUNNING = false;
  let BOT_CONFIG = {};

  const PIPELINE_STEPS = [
    { key: 'enableRead',       label: '📖 Read-to-Earn',  fn: doReadToEarn,      needsDOM: false },
    { key: 'enableCheckin',    label: '📱 Check-In',      fn: doAppCheckIn,      needsDOM: false },
    { key: 'enableClaimBonus', label: '🎉 Claim Bonus',   fn: doClaimBonus,      needsDOM: true  },
    { key: 'enableDashboard',  label: '🎯 Dashboard',     fn: doDashboardTasks,  needsDOM: true  },
    { key: 'enableEarn',       label: '🎁 Earn Page',     fn: doEarnTasks,       needsDOM: true  },
    { key: 'enableFlyout',     label: '🎪 Flyout',        fn: doFlyoutQuiz,      needsDOM: true  },
    { key: 'enableSearch',     label: '🔍 Searches',      fn: doSearches,        needsDOM: false }
  ];

  async function pushStatus(status) {
    await GM_setValue('ts_status', { ...status, ts: Date.now() });
  }

  function initBotEngine() {
    console.log('[TSP] Bot engine loaded on', HOST);

    GM_addValueChangeListener('ts_cmd', (n, oldV, newV, remote) => {
      if (!remote || !newV) return;
      if (Date.now() - newV.ts > 30000) return;

      if (newV.cmd === 'start') {
        BOT_RUNNING = false;
        runBotPipeline();
      } else if (newV.cmd === 'stop') {
        stopBot();
      }
    });

    // Resume check on page load (after search navigation, page reloads)
    GM_getValue('ts_pipeline', null).then((state) => {
      if (state && state.active && !BOT_RUNNING) {
        console.log('[TSP] Resuming pipeline from', state.completed);
        BOT_RUNNING = true;
        continuePipeline(state);
      }
    });
  }

  function stopBot() {
    BOT_RUNNING = false;
    GM_getValue('ts_pipeline', null).then((s) => {
      if (s) {
        s.active = false;
        GM_setValue('ts_pipeline', s);
      }
    });
    pushStatus({ running: false, taskLabel: '🛑 Stopped', percentage: 0 });
  }

  async function runBotPipeline() {
    if (BOT_RUNNING) return;
    BOT_RUNNING = true;

    const state = { active: true, completed: [] };
    await GM_setValue('ts_pipeline', state);
    await continuePipeline(state);
  }

  async function continuePipeline(state) {
    BOT_CONFIG = (await GM_getValue('ts_config', {})) || {};

    const enabledSteps = PIPELINE_STEPS.filter((s) => BOT_CONFIG[s.key]);
    const total = enabledSteps.length;

    if (total === 0) {
      await pushStatus({ running: false, taskLabel: '❌ Koi task enabled nahi', percentage: 0 });
      BOT_RUNNING = false;
      return;
    }

    let done = state.completed.length;

    for (const step of PIPELINE_STEPS) {
      if (!BOT_RUNNING) break;
      if (state.completed.includes(step.key)) continue;

      // Live config refresh
      BOT_CONFIG = (await GM_getValue('ts_config', {})) || {};
      if (!BOT_CONFIG[step.key]) {
        state.completed.push(step.key);
        await GM_setValue('ts_pipeline', state);
        continue;
      }

      // Wait for DOM if needed
      if (step.needsDOM) await waitForDOM();

      const pct = Math.round((done / total) * 100);
      await pushStatus({
        running: true,
        taskLabel: step.label,
        percentage: pct,
        progress: done + '/' + total
      });

      try {
        await step.fn(BOT_CONFIG);
        done++;
        state.completed.push(step.key);
        await GM_setValue('ts_pipeline', state);
      } catch (e) {
        console.error('[TSP] Step failed:', step.label, e);
        state.completed.push(step.key);
        await GM_setValue('ts_pipeline', state);
      }

      // Small pause between steps
      await sleep(1000);
    }

    if (BOT_RUNNING) {
      state.active = false;
      await GM_setValue('ts_pipeline', state);
      await pushStatus({
        running: false,
        taskLabel: '✅ All Done',
        percentage: 100,
        progress: total + '/' + total
      });
      GM_notification({ title: '✅ TrendSearch Pro', text: 'All tasks complete!' });
    }
    BOT_RUNNING = false;
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 6 — TASK FUNCTIONS
  // ═══════════════════════════════════════════════════════════════

  // ─── Token helper ───
  async function getAccessToken() {
    const saved = await GM_getValue('ts_token', null);
    if (saved && Date.now() - saved.ts < 55 * 60 * 1000) return saved.token;
    return null;
  }

  // ─── READ-TO-EARN (API) ───
  async function doReadToEarn(config) {
    await pushStatus({ taskLabel: '📖 Read-to-Earn', percentage: 1 });

    const token = await getAccessToken();
    if (!token) {
      console.warn('[TSP] No token — login required');
      await pushStatus({ taskLabel: '⚠️ No token — Bing pe login karo' });
      return;
    }

    const TOTAL = 10;
    for (let i = 0; i < TOTAL && BOT_RUNNING; i++) {
      const body = {
        country: 'IN',
        userAgent: navigator.userAgent,
        bodyData: {
          amount: 1,
          id: generateHex(32),
          type: 101,
          attributes: { offerid: 'REWARDS_READING_ARTICLE' },
          country: 'IN'
        }
      };
      try {
        const res = await gmFetch(READ_EARN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token
          },
          body: JSON.stringify(body)
        });
        console.log('[TSP] Read #' + (i + 1), res.status, res.responseText.slice(0, 100));
      } catch (e) {
        console.error('[TSP] Read failed', e);
      }
      await pushStatus({
        taskLabel: '📖 Article ' + (i + 1) + '/' + TOTAL,
        percentage: Math.round(1 + ((i + 1) / TOTAL) * 13)
      });
      await sleep(2000);
    }
  }

  // ─── APP CHECK-IN (API) ───
  async function doAppCheckIn(config) {
    await pushStatus({ taskLabel: '📱 Check-In', percentage: 15 });

    const token = await getAccessToken();
    if (!token) return;

    const body = {
      country: 'IN',
      userAgent: navigator.userAgent,
      bodyData: {
        risk_context: {},
        type: 103,
        channel: 'SAFARI',
        attributes: {},
        id: generateUUID(),
        amount: 1,
        country: 'IN'
      }
    };

    try {
      const res = await gmFetch(CHECKIN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token
        },
        body: JSON.stringify(body)
      });
      console.log('[TSP] Check-in:', res.status, res.responseText.slice(0, 100));
      await pushStatus({
        taskLabel: res.status === 200 ? '📱 Check-In ✅' : '📱 Check-In failed',
        percentage: 16
      });
    } catch (e) {
      console.error('[TSP] Check-in error', e);
    }
    await sleep(1500);
  }

  // ─── CLAIM BONUS (DOM) ───
  async function doClaimBonus(config) {
    await pushStatus({ taskLabel: '🎉 Claiming bonuses...', percentage: 17 });

    const btns = Array.from(
      document.querySelectorAll('a, button, div, span, p')
    ).filter((el) => {
      const t = (el.innerText || '').trim().toLowerCase();
      return (
        (t === 'claim' || t === 'claim >' || t === 'ready to claim' || t.includes('claim points')) &&
        el.children.length <= 2
      );
    });

    for (const btn of btns) {
      if (!BOT_RUNNING) return;
      const target = btn.closest('a, button, div[role="button"]') || btn;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await sleep(500);
      target.click();
      await sleep(1500);
    }
    await pushStatus({ taskLabel: '🎉 Bonus done', percentage: 20 });
  }

  // ─── DASHBOARD TASKS (DOM, may navigate) ───
  async function doDashboardTasks(config) {
    await pushStatus({ taskLabel: '🎯 Dashboard tasks...', percentage: 21 });

    if (!location.pathname.includes('/dashboard')) {
      // Navigate — pipeline will resume here after page load
      location.href = 'https://rewards.bing.com/dashboard';
      return;
    }

    const processed = new Set(JSON.parse((await GM_getValue('ts_dash_done', '[]')) || '[]'));
    let completed = 0;

    for (let i = 0; i < 8 && BOT_RUNNING; i++) {
      const cards = Array.from(
        document.querySelectorAll('a[href*="rewards"], a[class*="card"], div[role="button"]')
      );
      let clicked = false;

      for (const card of cards) {
        const text = (card.innerText || '').toLowerCase();
        const html = card.innerHTML.toLowerCase();
        if (html.includes('checkmark') || html.includes('completed')) continue;
        if (text.includes('goal') || text.includes('redeem') || text.includes('shop')) continue;

        const href = card.getAttribute('href') || card.href || '';
        const key = href || text.slice(0, 30);
        if (processed.has(key)) continue;

        processed.add(key);
        card.scrollIntoView({ block: 'center' });
        await sleep(400);
        card.click();
        clicked = true;
        completed++;
        await pushStatus({
          taskLabel: '🎯 Dashboard ' + completed,
          percentage: 21 + completed * 2
        });
        await sleep(3000);
        break;
      }
      if (!clicked) break;
    }
    await GM_setValue('ts_dash_done', JSON.stringify([...processed]));
    await pushStatus({ taskLabel: '🎯 Dashboard done', percentage: 30 });
  }

  // ─── EARN TASKS (DOM, may navigate) ───
  async function doEarnTasks(config) {
    await pushStatus({ taskLabel: '🎁 Earn page...', percentage: 31 });

    if (!location.pathname.includes('/earn')) {
      location.href = 'https://rewards.bing.com/earn';
      return;
    }

    const processed = new Set(JSON.parse((await GM_getValue('ts_earn_done', '[]')) || '[]'));
    let completed = 0;

    for (let i = 0; i < 10 && BOT_RUNNING; i++) {
      const cards = Array.from(
        document.querySelectorAll('span[role="link"], a, [class*="card"], div[role="button"]')
      );
      let clicked = false;

      for (const card of cards) {
        const text = card.innerText || '';
        const html = card.innerHTML.toLowerCase();
        if (html.includes('checkmark') || html.includes('completed')) continue;
        if (text.toLowerCase().includes('streak') || text.toLowerCase().includes('check-in')) continue;

        const href = card.getAttribute('href') || '';
        if (!href && !text.match(/\+(\d+)/)) continue;

        const key = href || text.slice(0, 30);
        if (processed.has(key)) continue;

        processed.add(key);
        card.scrollIntoView({ block: 'center' });
        await sleep(400);
        card.click();
        clicked = true;
        completed++;
        await pushStatus({
          taskLabel: '🎁 Earn ' + completed,
          percentage: 31 + completed * 2
        });
        await sleep(3000);
        break;
      }
      if (!clicked) break;
    }
    await GM_setValue('ts_earn_done', JSON.stringify([...processed]));
    await pushStatus({ taskLabel: '🎁 Earn done', percentage: 42 });
  }

  // ─── FLYOUT QUIZ (DOM) ───
  async function doFlyoutQuiz(config) {
    await pushStatus({ taskLabel: '🎪 Flyout quiz...', percentage: 43 });

    const flyoutBtn =
      document.querySelector('[aria-label*="Rewards"]') ||
      document.querySelector('button[aria-label*="Microsoft Rewards"]') ||
      document.querySelector('[id*="rewards-flyout"]');

    if (flyoutBtn) {
      flyoutBtn.click();
      await sleep(2000);

      const quiz = document.querySelector('[class*="quiz"], [class*="bonus"], a[href*="quiz"]');
      if (quiz) {
        quiz.click();
        await sleep(2000);
      }
    }
    await pushStatus({ taskLabel: '🎪 Flyout done', percentage: 48 });
  }

  // ─── SEARCHES (DOM + navigation persistence) ───
  async function doSearches(config) {
    // Check for existing session (after reload)
    let session = await GM_getValue('ts_search_session', null);
    if (session && session.active) {
      await continueSearchSession(session);
      return;
    }

    await pushStatus({ taskLabel: '🔍 Preparing searches...', percentage: 49 });

    // Fetch queries
    let queries = [];
    try {
      const res = await gmFetch(NEWS_URL);
      const json = JSON.parse(res.responseText);
      if (json.articles && Array.isArray(json.articles)) {
        queries = json.articles
          .map((a) => (a.title || '').replace(/\s*-\s*[^-]+$/, '').trim())
          .filter((t) => t && t.length > 8);
      }
    } catch (e) {
      console.warn('[TSP] News fetch failed, using defaults');
    }

    if (queries.length === 0) {
      queries = [
        'weather today', 'best smartphones 2025', 'how to learn coding',
        'ipl match schedule', 'stock market news', 'healthy breakfast recipes',
        'best laptops under 50000', 'python tutorial', 'cricket score today',
        'travel destinations india'
      ];
    }

    queries = [...new Set(queries)].sort(() => Math.random() - 0.5).slice(0, config.max || 20);

    session = {
      active: true,
      queries,
      index: 0,
      delayRange: config.delayRange || '10-20'
    };
    await GM_setValue('ts_search_session', session);
    await continueSearchSession(session);
  }

  async function continueSearchSession(session) {
    if (!BOT_RUNNING && session.active) {
      session.active = false;
      await GM_setValue('ts_search_session', session);
      return;
    }

    if (session.index >= session.queries.length) {
      session.active = false;
      await GM_setValue('ts_search_session', session);
      await GM_deleteValue('ts_search_session');
      return;
    }

    const q = session.queries[session.index];
    const pct = Math.round((session.index / session.queries.length) * 100);

    await pushStatus({
      taskLabel: '🔍 Search ' + (session.index + 1) + '/' + session.queries.length,
      percentage: 49 + Math.round(pct * 0.51),
      progress: session.index + 1 + '/' + session.queries.length
    });

    session.index++;
    await GM_setValue('ts_search_session', session);

    const [minS, maxS] = (session.delayRange || '10-20').split('-').map(Number);
    const delay = (minS + Math.random() * (maxS - minS)) * 1000;

    console.log('[TSP] Next search in ' + Math.round(delay / 1000) + 's:', q);
    await sleep(1500);

    // Navigate — page reloads, bot resumes here
    location.href = 'https://www.bing.com/search?q=' + encodeURIComponent(q);
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 7 — ROUTE INIT
  // ═══════════════════════════════════════════════════════════════
  if (IS_DASHBOARD) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initDashboardBridge, { once: true });
    } else {
      initDashboardBridge();
    }
  } else if (IS_BOT) {
    initBotEngine();
  }
})();
