/**
 * CuraFlow — Global Type Declarations
 *
 * These declarations provide type information for globals that are not
 * covered by @types/react or other DefinitelyTyped packages.
 */

// Vite import.meta.env types
/// <reference types="vite/client" />

// Global build info injected by Vite at build time
declare global {
  var __CURAFLOW_BUILD_INFO__:
    | {
        commitSha: string;
        commitShortSha: string;
      }
    | undefined;
}

export {};
