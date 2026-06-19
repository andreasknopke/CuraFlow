import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from '../use-mobile';

describe('useIsMobile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when viewport is wider than the mobile breakpoint', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn((_, handler) => {
        // Store handler for later invocation
      }),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('returns true when viewport is at the mobile breakpoint', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(767);
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('returns true when viewport is narrower than the mobile breakpoint', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(375);
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('updates state when the viewport is resized from desktop to mobile', () => {
    let resizeHandler = null;
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn((_, handler) => {
        resizeHandler = handler;
      }),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    // Simulate resize to mobile
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(480);
    act(() => {
      resizeHandler();
    });

    expect(result.current).toBe(true);
  });

  it('updates state when the viewport is resized from mobile to desktop', () => {
    let resizeHandler = null;
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(480);
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn((_, handler) => {
        resizeHandler = handler;
      }),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);

    // Simulate resize to desktop
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
    act(() => {
      resizeHandler();
    });

    expect(result.current).toBe(false);
  });

  it('cleans up the event listener on unmount', () => {
    const removeEventListener = vi.fn();
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
    vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
      matches: false,
      media: '',
      addEventListener: vi.fn(),
      removeEventListener,
    }));

    const { unmount } = renderHook(() => useIsMobile());
    unmount();

    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });
});
