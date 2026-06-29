/**
 * CuraFlow — General UI Utilities
 *
 * cn() — Tailwind CSS class merging via clsx + tailwind-merge.
 * isIframe — detects whether the app is running inside an iframe.
 *
 * @module lib/utils
 */

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ClassValue } from 'clsx';

/**
 * Merges Tailwind CSS class names, resolving conflicts via tailwind-merge.
 * Accepts strings, arrays, objects, null, undefined, false.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** True if the current page is loaded inside an iframe. */
export const isIframe: boolean = window.self !== window.top;
