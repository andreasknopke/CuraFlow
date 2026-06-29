/**
 * CuraFlow — App Parameters
 *
 * Reads Base44 / embed parameters from URL search params and localStorage.
 * Used when the app is embedded in an iframe via the Base44 platform.
 *
 * @module lib/app-params
 *
 * @unused Currently no active consumers. Voice control & AI scheduling
 *         features that used these params have been disabled / not deployed.
 *         If re-enabled, re-export need to be verified.
 */

const isNode = typeof window === 'undefined';
// In Node SSR context, use a noop Map. In browser, use real localStorage.
const windowObj: { localStorage: Storage | Map<string, string> } = isNode
  ? { localStorage: new Map<string, string>() }
  : (window as unknown as { localStorage: Storage });
const storage = windowObj.localStorage;

const toSnakeCase = (str: string): string => {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
};

interface AppParamOptions {
  defaultValue?: string;
  removeFromUrl?: boolean;
}

const getAppParamValue = (
  paramName: string,
  { defaultValue = undefined, removeFromUrl = false }: AppParamOptions = {},
): string | undefined | null => {
  if (isNode) {
    return defaultValue;
  }
  const storageKey = `base44_${toSnakeCase(paramName)}`;
  const urlParams = new URLSearchParams(window.location.search);
  const searchParam = urlParams.get(paramName);
  if (removeFromUrl) {
    urlParams.delete(paramName);
    const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ''}${window.location.hash}`;
    window.history.replaceState({}, document.title, newUrl);
  }
  if (searchParam) {
    if (storage instanceof Map) {
      storage.set(storageKey, searchParam);
    } else {
      storage.setItem(storageKey, searchParam);
    }
    return searchParam;
  }
  if (defaultValue) {
    if (storage instanceof Map) {
      storage.set(storageKey, defaultValue);
    } else {
      storage.setItem(storageKey, defaultValue);
    }
    return defaultValue;
  }
  const storedValue = storage instanceof Map ? storage.get(storageKey) : storage.getItem(storageKey);
  if (storedValue) {
    return storedValue;
  }
  return null;
};

interface AppParams {
  appId: string | undefined | null;
  serverUrl: string | undefined | null;
  token: string | undefined | null;
  fromUrl: string | undefined | null;
  functionsVersion: string | undefined | null;
}

const getAppParams = (): AppParams => {
  return {
    appId: getAppParamValue('app_id', { defaultValue: import.meta.env.VITE_BASE44_APP_ID }),
    serverUrl: getAppParamValue('server_url', {
      defaultValue: import.meta.env.VITE_BASE44_BACKEND_URL,
    }),
    token: getAppParamValue('access_token', { removeFromUrl: true }),
    fromUrl: getAppParamValue('from_url', { defaultValue: window.location.href }),
    functionsVersion: getAppParamValue('functions_version'),
  };
};

export const appParams: AppParams = {
  ...getAppParams(),
};
