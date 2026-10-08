/*
 * background.js — MV3 service worker (classic, so it can importScripts the shared module).
 *
 * Responsibilities
 *  - Single writer to chrome.storage.local (writes are serialized through a queue).
 *  - Validates that data messages come from the right origin
 *    (Blackboard snapshot only from https://learn.uark.edu, Pearson records only from *.pearson.com).
 *  - Merges new snapshots over the cache without discarding good data (BBX.mergeBlackboard).
 *  - Periodic alarm: asks already-open Blackboard / Pearson tabs to refresh.
 *    It never opens tabs, never reads tab URLs it isn't permitted to (no "tabs"
 *    permission; tab URL filtering works through host_permissions), never fetches on its own.
 */
importScripts('shared/normalize.js');

const K = BBX.STORAGE_KEYS;
const ALARM = 'bbx-refresh';
const ALARM_MINUTES = 30;
const BB_TAB_PATTERN = 'https://learn.uark.edu/*';
const PEARSON_TAB_PATTERNS = ['https://mylab.pearson.com/*', 'https://*.pearson.com/*'];

// ------------------------------------------------------------ write queue
let queue = Promise.resolve();
function serialized(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}
const getLocal = (keys) => chrome.storage.local.get(keys);
const setLocal = (obj) => chrome.storage.local.set(obj);

// ------------------------------------------------------------ lifecycle
chrome.runtime.onInstalled.addListener(async () => {
  try {
    chrome.alarms.create(ALARM, { periodInMinutes: ALARM_MINUTES, delayInMinutes: 1 });
    // Initialise ONLY missing keys, with empty values. Never sample data.
    const cur = await getLocal([K.pearson, K.status, K.prefs]);
    const init = {};
    if (!cur[K.pearson]) init[K.pearson] = { records: {} };
    if (!cur[K.status]) init[K.status] = {};
    if (!cur[K.prefs]) init[K.prefs] = {};
    if (Object.keys(init).length) await setLocal(init);
  } catch (e) { console.warn('[BBX] onInstalled failed', e); }
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.get(ALARM, (a) => { if (!a) chrome.alarms.create(ALARM, { periodInMinutes: ALARM_MINUTES }); });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) pokeOpenTabs({ force: false, reason: 'alarm' }).catch((e) => console.warn('[BBX] alarm poke failed', e));
});

// ------------------------------------------------------------ helpers
function originOf(sender) {
  try { return new URL(sender.url || (sender.tab && sender.tab.url) || '').origin; } catch (_) { return ''; }
}
const fromBlackboard = (sender) => sender.id === chrome.runtime.id && originOf(sender) === 'https://learn.uark.edu';
const fromPearson = (sender) => {
  if (sender.id !== chrome.runtime.id) return false;
  try { const h = new URL(sender.url || '').hostname; return h === 'pearson.com' || h.endsWith('.pearson.com'); } catch (_) { return false; }
};
const fromExtensionPage = (sender) => sender.id === chrome.runtime.id && (sender.url || '').startsWith(chrome.runtime.getURL(''));

async function updateStatus(system, patch) {
  return serialized(async () => {
    const cur = (await getLocal(K.status))[K.status] || {};
    const prev = cur[system] || {};
    const next = { ...prev, ...patch };
    // Keep lastSuccessAt / source from the last good sync when a failure arrives.
    if (!patch.lastSuccessAt) next.lastSuccessAt = prev.lastSuccessAt;
    if (!patch.source && prev.source) next.source = prev.source;
    if (patch.state === 'ok') delete next.message;
    cur[system] = next;
    await setLocal({ [K.status]: cur });
    return next;
  });
}

/** Ask open Blackboard / Pearson tabs (if any) to sync. Uses url filters (host permissions), not "tabs". */
async function pokeOpenTabs({ force, reason }) {
  const result = { blackboardTabs: 0, pearsonTabs: 0 };
  try {
    const bbTabs = await chrome.tabs.query({ url: BB_TAB_PATTERN });
    result.blackboardTabs = bbTabs.length;
    for (const t of bbTabs.slice(0, 1)) { // one tab is enough
      try { await chrome.tabs.sendMessage(t.id, { type: 'bbx:sync', force, reason }); } catch (e) { /* tab not ready / no content script yet */ }
    }
  } catch (e) { console.warn('[BBX] BB tab query failed', e); }
  try {
    const peTabs = await chrome.tabs.query({ url: PEARSON_TAB_PATTERNS });
    result.pearsonTabs = peTabs.length;
    for (const t of peTabs) {
      try { await chrome.tabs.sendMessage(t.id, { type: 'bbx:sync', force, reason }); } catch (e) { /* not a results page */ }
    }
  } catch (e) { console.warn('[BBX] Pearson tab query failed', e); }
  return result;
}

// ------------------------------------------------------------ messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string' || sender.id !== chrome.runtime.id) return false;
  const reply = (p) => { p.then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message || e) })); return true; };

  switch (msg.type) {
    case 'bbx:storeBlackboard': {
      if (!fromBlackboard(sender)) { sendResponse({ ok: false, error: 'rejected: wrong origin' }); return false; }
      const snap = msg.snapshot;
      if (!snap || typeof snap !== 'object' || !Array.isArray(snap.courses)) { sendResponse({ ok: false, error: 'rejected: malformed snapshot' }); return false; }
      return reply(serialized(async () => {
        const prev = (await getLocal(K.blackboard))[K.blackboard] || null;
        const merged = BBX.mergeBlackboard(prev, snap);
        await setLocal({ [K.blackboard]: merged });
        return { ok: true, courses: merged.courses.length };
      }));
    }
    case 'bbx:storePearson': {
      if (!fromPearson(sender)) { sendResponse({ ok: false, error: 'rejected: wrong origin' }); return false; }
      const rec = msg.record;
      if (!rec || rec.source !== BBX.SOURCES.PEARSON || typeof rec.key !== 'string' || !rec.key) { sendResponse({ ok: false, error: 'rejected: malformed record' }); return false; }
      return reply(serialized(async () => {
        const cur = (await getLocal(K.pearson))[K.pearson] || { records: {} };
        cur.records = cur.records || {};
        // A part the new parse missed keeps the previous good value (marked stale), never lost.
        cur.records[rec.key] = BBX.mergePearsonRecord(cur.records[rec.key], rec);
        await setLocal({ [K.pearson]: cur });
        return { ok: true };
      }));
    }
    case 'bbx:status': {
      const sys = msg.system;
      const okSender = (sys === 'blackboard' && fromBlackboard(sender)) || (sys === 'pearson' && fromPearson(sender));
      if (!okSender || !msg.status || typeof msg.status.state !== 'string') { sendResponse({ ok: false }); return false; }
      return reply(updateStatus(sys, msg.status).then(() => ({ ok: true })));
    }
    case 'bbx:getStatus':
      return reply(getLocal(K.status).then((r) => r[K.status] || {}));
    case 'bbx:requestSync': {
      if (!fromExtensionPage(sender)) { sendResponse({ ok: false }); return false; }
      return reply(pokeOpenTabs({ force: true, reason: 'dashboard' }).then((r) => ({ ok: true, ...r })));
    }
    case 'bbx:clearCache': {
      if (!fromExtensionPage(sender)) { sendResponse({ ok: false }); return false; }
      return reply(serialized(async () => {
        await chrome.storage.local.remove([K.blackboard, K.pearson, K.status]);
        await setLocal({ [K.pearson]: { records: {} }, [K.status]: {} });
        return { ok: true };
      }));
    }
    default:
      return false;
  }
});
