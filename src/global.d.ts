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

// During incremental TS conversion, .jsx components (forwardRef wrappers)
// resolve to `IntrinsicAttributes & RefAttributes<any>` which lacks children
// and custom props. Adding generic props here until components are .tsx.
declare global {
  namespace JSX {
    interface IntrinsicAttributes {
      children?: any;
      className?: string;
      [key: string]: any;
    }
  }
}

export {};
