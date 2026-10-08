/// <reference types="vite/client" />

interface ChromeRuntime {
  sendMessage: (msg: unknown, cb?: (response: unknown) => void) => void;
  lastError?: { message?: string };
}

interface ChromeStorageChange {
  newValue?: unknown;
}

interface ChromeNamespace {
  storage?: {
    local: {
      get: (keys: string[]) => Promise<Record<string, unknown>>;
    };
    onChanged?: {
      addListener: (cb: (changes: Record<string, ChromeStorageChange>, area: string) => void) => void;
    };
  };
  runtime?: ChromeRuntime;
}

declare const chrome: ChromeNamespace | undefined;
