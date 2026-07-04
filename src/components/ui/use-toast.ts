// Inspired by react-hot-toast library
import * as React from "react";
import { useState, useEffect } from "react";

const TOAST_LIMIT = 5;
const TOAST_AUTO_DISMISS_DELAY = 5000;
const TOAST_REMOVE_DELAY = 4000;

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const;

type ActionType = typeof actionTypes[keyof typeof actionTypes];

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_VALUE;
  return count.toString();
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const toastDismissTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: "REMOVE_TOAST",
      toastId,
    });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(toastId, timeout);
};

const _clearFromRemoveQueue = (toastId: string) => {
  const timeout = toastTimeouts.get(toastId);
  if (timeout) {
    clearTimeout(timeout);
    toastTimeouts.delete(toastId);
  }
};

const addToDismissQueue = (toastId: string) => {
  if (toastDismissTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastDismissTimeouts.delete(toastId);
    dispatch({
      type: "DISMISS_TOAST",
      toastId,
    });
  }, TOAST_AUTO_DISMISS_DELAY);

  toastDismissTimeouts.set(toastId, timeout);
};

const clearFromDismissQueue = (toastId: string) => {
  const timeout = toastDismissTimeouts.get(toastId);
  if (timeout) {
    clearTimeout(timeout);
    toastDismissTimeouts.delete(toastId);
  }
};

// ---
// Types
// ---

export interface Toast {
  title?: string
  description?: string
  action?: React.ReactNode
  variant?: "default" | "destructive"
  [key: string]: unknown
}

export type ToasterToast = Toast & {
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ToastAction =
  | { type: "ADD_TOAST"; toast: ToasterToast }
  | { type: "UPDATE_TOAST"; toast: Partial<ToasterToast> }
  | { type: "DISMISS_TOAST"; toastId?: string }
  | { type: "REMOVE_TOAST"; toastId?: string }

interface State {
  toasts: ToasterToast[]
}

export const reducer = (state: State, action: ToastAction): State => {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };

    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      };

    case "DISMISS_TOAST": {
      const { toastId } = action;

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id);
        });
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t
        ),
      };
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) {
        state.toasts.forEach((toast) => {
          clearFromDismissQueue(toast.id);
          _clearFromRemoveQueue(toast.id);
        });
        return {
          ...state,
          toasts: [],
        };
      }
      clearFromDismissQueue(action.toastId);
      _clearFromRemoveQueue(action.toastId);
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
};

const listeners: Array<(state: State) => void> = [];

let memoryState: State = { toasts: [] };

function dispatch(action: ToastAction) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

interface ToastReturn {
  id: string
  dismiss: () => void
  update: (props: Partial<ToasterToast>) => void
}

function toast({ ...props }: Toast): ToastReturn {
  const id = genId();

  const update = (props: Partial<ToasterToast>) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props, id },
    });

  const dismiss = () =>
    dispatch({ type: "DISMISS_TOAST", toastId: id });

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });

  addToDismissQueue(id);

  return {
    id,
    dismiss,
    update,
  };
}

interface UseToastReturn {
  toasts: ToasterToast[]
  toast: (props: Toast) => ToastReturn
  dismiss: (toastId: string) => void
}

function useToast(): UseToastReturn {
  const [state, setState] = useState<State>(memoryState);

  useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, [state]);

  return {
    ...state,
    toast,
    dismiss: (toastId: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  };
}

export { useToast, toast };
