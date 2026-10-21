// ══════════════ BRIDGE ══════════════
let bridgeReady = false;
let botRunning = false;
const pending = new Map();
let nextId = 1;

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data) return;

  if (e.data.type === 'EXT_BRIDGE_READY') {
    bridgeReady = true;
    onReady();
  } else if (e.data.type === 'EXT_RESPONSE') {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.response);
  } else if (e.data.type === 'EXT_PUSH') {
    if (e.data.payload && e.data.payload.status) applyStatus(e.data.payload.status);
  }
});

function ext(action, data = {}) {
  return new Promise((resolve, reject) => {
    if (!bridgeReady) return reject(new Error('Bot not installed'));
    const id = nextId++;
    pending.set(id, { resolve, reject });
    window.postMessage({ type: 'EXT_CALL', id, payload: { action, ...data } }, '*');
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('Timeout')); }
    }, 6000);
  });
}

// ══════════════ HELPERS ══════════════
const $ = (id) => document.getElementById(id);
const flash = (t) => { $('msg').textContent = t; setTimeout(() => $('msg').textContent = '', 3500); };
function setBanner(ok, text) {
  $('connBanner').className = ok ? 'conn-ok' : 'conn-bad';
  $('connBanner').textContent = text;
}

// ══════════════ CONFIG ══════════════
function collectConfig() {
  return {
    enableRead:       $('tRead').checked,
    enableCheckin:    $('tCheckin').checked,
    enableClaimBonus: $('tClaim').checked,
    enableDashboard:  $('tDash').checked,
    enableEarn:       $('tEarn').checked,
    enableFlyout:     $('tFly').checked,
    enableSearch:     $('tSearch').checked,
    max:              parseInt($('maxSearch').value, 10),
    delayRange:       $('delaySelect').value,
    mode:             $('modeSelect').value
  };
}

// Wire every input for live update
['tRead','tCheckin','tClaim','tDash','tEarn','tFly','tSearch',
 'maxSearch','delaySelect','modeSelect'].forEach((id) => {
  $(id).addEventListener('change', async () => {
    const cfg = collectConfig();
    localStorage.setItem('tsp_config', JSON.stringify(cfg));
    if (bridgeReady) {
      try { await ext('updateConfig', { config: cfg }); } catch (e) {}
    }
  });
});

// Restore config
(function restore() {
  try {
    const s = JSON.parse(localStorage.getItem('tsp_config') || 'null');
    if (!s) return;
    if (typeof s.enableRead === 'boolean') $('tRead').checked = s.enableRead;
    if (typeof s.enableCheckin === 'boolean') $('tCheckin').checked = s.enableCheckin;
    if (typeof s.enableClaimBonus === 'boolean') $('tClaim').checked = s.enableClaimBonus;
    if (typeof s.enableDashboard === 'boolean') $('tDash').checked = s.enableDashboard;
    if (typeof s.enableEarn === 'boolean') $('tEarn').checked = s.enableEarn;
    if (typeof s.enableFlyout === 'boolean') $('tFly').checked = s.enableFlyout;
    if (typeof s.enableSearch === 'boolean') $('tSearch').checked = s.enableSearch;
    if (s.max) $('maxSearch').value = s.max;
    if (s.delayRange) $('delaySelect').value = s.delayRange;
    if (s.mode) $('modeSelect').value = s.mode;
  } catch (e) {}
})();

// ══════════════ READY ══════════════
async function onReady() {
  setBanner(true, '✅ Bot connected');
  try {
    const s = await ext('getStatus');
    if (s && s.licenseActive === false) {
      $('activationView').classList.remove('hide');
      $('mainView').classList.add('hide');
    } else {
      $('activationView').classList.add('hide');
      $('mainView').classList.remove('hide');
      applyStatus(s);
      startPolling();
    }
  } catch (e) {
    setBanner(false, '⚠️ ' + e.message);
  }
}

// ══════════════ STATUS ══════════════
function applyStatus(s) {
  if (!s) return;
  botRunning = !!s.running;
  $('botStatus').textContent = s.running ? 'Running ✅' : 'Stopped';
  $('taskLabel').textContent = s.taskLabel || '-';
  $('botProgress').textContent = s.progress || '-';
  const pct = Number(s.percentage || 0);
  $('progressFill').style.width = pct + '%';
  $('pctBadge').textContent = pct + '%';
  $('startBtn').disabled = botRunning;
  $('stopBtn').disabled = !botRunning;
}

function startPolling() {
  setInterval(async () => {
    try { applyStatus(await ext('getStatus')); } catch (e) {}
  }, 1200);
}

// ══════════════ ACTIVATE ══════════════
$('activateBtn').addEventListener('click', async () => {
  const key = $('licenseInput').value.trim();
  if (!key) return flash('Enter license key');
  flash('Verifying...');
  try {
    const res = await ext('activateLicense', { key });
    if (res && res.valid) {
      flash('✅ Activated');
      $('activationView').classList.add('hide');
      $('mainView').classList.remove('hide');
      startPolling();
    } else flash('❌ ' + ((res && res.reason) || 'Invalid'));
  } catch (e) { flash('❌ ' + e.message); }
});

// ══════════════ START/STOP ══════════════
$('startBtn').addEventListener('click', async () => {
  const cfg = collectConfig();
  const anyOn = ['enableRead','enableCheckin','enableClaimBonus','enableDashboard',
                 'enableEarn','enableFlyout','enableSearch'].some((k) => cfg[k]);
  if (!anyOn) return flash('❌ Kam se kam ek task select karo');
  flash('Starting bot...');
  try {
    const res = await ext('startPipeline', cfg);
    if (res && res.error) flash('❌ ' + res.error);
    else flash('▶️ Bot started — rewards tab khul raha hai...');
  } catch (e) { flash('❌ ' + e.message); }
});

$('stopBtn').addEventListener('click', async () => {
  try { await ext('stop'); flash('🛑 Stopped'); }
  catch (e) { flash('❌ ' + e.message); }
});

// ══════════════ MISSING BOT TIMEOUT ══════════════
setTimeout(() => {
  if (!bridgeReady) {
    setBanner(false, '❌ Bot install nahi hai');
    $('installView').classList.remove('hide');
    $('msg').textContent = 'Bot install karo (2 step), phir page refresh karo.';
  }
}, 3000);
