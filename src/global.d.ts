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

// react-beautiful-dnd / @hello-pangea/dnd React 18+ type fix
// @hello-pangea/dnd v17 types use children render-function props (DraggableChildrenFn, DroppableChildrenFn).
// The global JSX.IntrinsicAttributes augmentation below (with [key: string]: unknown index signature)
// causes TypeScript to widen children prop types, creating an impossible intersection
// `ReactNode & FunctionType`. This module augmentation overrides children to be `any`,
// which satisfies both the render function and the widened intersection.
declare module '@hello-pangea/dnd' {
  interface DraggableProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    children?: any;
  }
  interface DroppableProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    children?: any;
  }
}

// During incremental TS conversion, .jsx components (forwardRef wrappers)
// resolve to `IntrinsicAttributes & RefAttributes<any>` which lacks children
// and custom props. Adding generic props here until components are .tsx.
// Note: `children` is NOT included here because it causes impossible intersections
// with library components that use function-type children props (e.g., @hello-pangea/dnd).
declare global {
  namespace JSX {
    interface IntrinsicAttributes {
      className?: string;
      [key: string]: unknown;
    }
  }
}

export {};
