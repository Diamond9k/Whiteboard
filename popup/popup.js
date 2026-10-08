// popup.js — tiny status panel. Reads sync status from chrome.storage.local; shows no course data.
// Messages used (unchanged contract): { type: 'bbx:requestSync' } -> { blackboardTabs, pearsonTabs }.
(() => {
  'use strict';
  const K = globalThis.BBX && globalThis.BBX.STORAGE_KEYS;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const parse = (iso) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d : null; };
  const fmt = (d) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d) + ' CT';
  const ago = (d) => {
    const s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  };
  const SRC = { 'blackboard-api': 'Blackboard API', 'blackboard-dom': 'Blackboard page', pearson: 'Pearson MyLab' };

  /** Human state words + tone for one system's status record. */
  function describe(s) {
    const last = parse(s.lastSuccessAt);
    const age = last ? ago(last) : null;
    const old = last && Date.now() - last.getTime() > 864e5;
    switch (s.state) {
      case 'ok': return { tone: old ? 'warn' : 'ok', text: old ? `Last synced ${age}` : `Synced ${age || ''}`.trim() };
      case 'session-expired': return { tone: 'warn', text: 'Sign-in expired', sub: age ? `Showing data from ${age}` : 'Nothing cached yet' };
      case 'error': return { tone: 'bad', text: 'Last sync failed', sub: age ? `Showing data from ${age}` : '' };
      case 'partial': case 'parse-partial': return { tone: 'warn', text: `Partly read${age ? ` · ${age}` : ''}` };
      case 'parse-failed': return { tone: 'bad', text: "Page couldn't be read", sub: age ? `Earlier data from ${age} kept` : '' };
      default: return s.state ? { tone: 'warn', text: String(s.state) } : { tone: 'none', text: 'Not synced yet' };
    }
  }

  function row(name, s) {
    s = s || {};
    const d = describe(s);
    const last = parse(s.lastSuccessAt);
    const bits = [];
    if (d.sub) bits.push(d.sub);
    if (last) bits.push(`${fmt(last)}${s.source ? ` · via ${SRC[s.source] || s.source}` : ''}`);
    if (s.message) bits.push(s.message);
    return `<div class="row"><div class="row-top"><strong>${esc(name)}</strong><span class="state state-${d.tone}"><i class="dot" aria-hidden="true"></i>${esc(d.text)}</span></div>
      ${bits.length ? `<p class="detail">${bits.map(esc).join('<br>')}</p>` : ''}</div>`;
  }

  async function load() {
    try {
      if (!K) throw new Error('normalize module missing');
      const st = (await chrome.storage.local.get(K.status))[K.status] || {};
      $('status').innerHTML = row('Blackboard', st.blackboard) + row('MyLab', st.pearson);
      // Expired Blackboard sign-in: signing in is the one useful action, so it leads.
      const expired = !!(st.blackboard && st.blackboard.state === 'session-expired');
      $('signin').hidden = !expired;
      $('open').classList.toggle('ghost', expired);
    } catch (e) {
      $('status').innerHTML = `<p class="muted">Could not read status: ${esc(e.message || e)}</p>`;
    }
  }

  $('open').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }));
  $('sync').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'bbx:requestSync' }, (r) => {
      if (chrome.runtime.lastError || !r) { $('msg').textContent = 'Sync request failed.'; return; }
      $('msg').textContent = r.blackboardTabs + r.pearsonTabs === 0
        ? 'No Blackboard or MyLab tab is open. Open one while signed in, then try again.'
        : 'Asked open tab(s) to refresh…';
    });
  });
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && K && c[K.status]) load(); });
  load();
})();
