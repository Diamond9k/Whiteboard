import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { DashboardData, SysStatus } from '../types';
import { parseDate } from './format';

const STALE_MS = 24 * 3600 * 1000;

export interface Trust {
  bb: SysStatus;
  pe: SysStatus;
  bbLast: Date | null;
  peLast: Date | null;
  peFromRecord: boolean;
}

export interface SysInfo {
  s: SysStatus;
  last: Date | null;
  state: string | null;
  fromRecord: boolean;
}

const EMPTY: Trust = { bb: {}, pe: {}, bbLast: null, peLast: null, peFromRecord: false };
const Ctx = createContext<Trust>(EMPTY);

function compute(data: DashboardData): Trust {
  const s = data.status || {};
  const bb = s.blackboard || {};
  const pe = s.pearson || {};
  let bbLast = parseDate(bb.lastSuccessAt);
  if (!bbLast && data._meta) bbLast = parseDate(data._meta.pulled_at);
  let peLast = parseDate(pe.lastSuccessAt);
  let peFromRecord = false;
  if (!peLast) {
    const times: string[] = [];
    for (const c of data.courses || []) if (c.pearson?.syncedAt) times.push(c.pearson.syncedAt);
    for (const p of data.unmatchedPearson || []) if (p.syncedAt) times.push(p.syncedAt);
    times.sort();
    peLast = parseDate(times[times.length - 1]);
    peFromRecord = !!peLast;
  }
  return { bb, pe, bbLast, peLast, peFromRecord };
}

export function TrustProvider({ data, children }: { data: DashboardData; children: ReactNode }) {
  const value = useMemo(() => compute(data), [data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTrust() { return useContext(Ctx); }

export function sysInfo(trust: Trust, key: 'blackboard' | 'pearson'): SysInfo {
  const isPe = key === 'pearson';
  const s = isPe ? trust.pe : trust.bb;
  const last = isPe ? trust.peLast : trust.bbLast;
  let state = s.state || (last ? 'ok' : null);
  if (state === 'ok' && last && Date.now() - last.getTime() > STALE_MS) state = 'stale';
  return { s, last, state, fromRecord: isPe && trust.peFromRecord };
}

export function bbIsStale(trust: Trust): boolean {
  const st = trust.bb.state;
  return !!trust.bbLast && (st === 'session-expired' || st === 'error' || Date.now() - trust.bbLast.getTime() > STALE_MS);
}

export function staleWhy(trust: Trust): string {
  return trust.bb.state === 'session-expired'
    ? 'Blackboard sign-in expired'
    : trust.bb.state === 'error'
      ? 'the last Blackboard sync failed'
      : 'Blackboard data is more than a day old';
}

export function isMaybePast(trust: Trust, u?: { status?: string; due?: string } | null): boolean {
  if (!u || u.status !== 'due' || !bbIsStale(trust)) return false;
  const d = parseDate(u.due);
  return !!d && d.getTime() < Date.now();
}

export function maybePastLabel(trust: Trust): string {
  return `Past due · status unknown since last sync (${trust.bbLast ? formatMonth(trust.bbLast) : 'date unknown'})`;
}

function formatMonth(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(d);
}

export function maybePastFull(trust: Trust): string {
  const when = trust.bbLast
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(trust.bbLast) + ' CT'
    : 'time unknown';
  return `Blackboard last reported this as not yet due (${when}). Its due time has passed since; whether it was submitted is unknown until Blackboard syncs again.`;
}
