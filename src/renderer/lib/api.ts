import type { DesktopApi } from '../../main/preload';

declare global {
  interface Window {
    api: DesktopApi;
  }
}

export const api: DesktopApi = window.api;
