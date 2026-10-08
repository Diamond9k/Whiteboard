import { createContext, useContext } from 'react';
import type { DashboardData, Prefs } from './types';

export interface DashApi {
  data: DashboardData;
  prefs: Prefs;
  showPast: boolean;
  setShowPast: (v: boolean) => void;
  syncMsg: string;
  requestSync: () => Promise<void>;
  clearCache: () => Promise<void>;
  setPrefs: (patch: Partial<Prefs>) => Promise<void>;
  openSearch: () => void;
  openShortcuts: () => void;
  gradesOpen: ReadonlySet<string>;
  toggleGrade: (id: string) => void;
}

const Ctx = createContext<DashApi | null>(null);

export const DashProvider = Ctx.Provider;

export function useDash(): DashApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('Dashboard context missing');
  return v;
}
