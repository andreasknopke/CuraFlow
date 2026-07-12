import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';

// ── Helpers ──────────────────────────────────────────────────────────────────

function NormalChild() {
  return <div data-testid="child-content">All good</div>;
}

function ThrowingChild() {
  throw new Error('test crash');
}

// Suppress console.error from React's error boundary logging
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = vi.fn();
});
afterAll(() => {
  console.error = originalConsoleError;
});

describe('ErrorBoundary', () => {
  it('renders children normally when no error', () => {
    render(
      <ErrorBoundary>
        <NormalChild />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('renders fallback UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );

    // Fallback heading
    expect(screen.getByText('Ein Fehler ist aufgetreten')).toBeInTheDocument();

    // Action buttons
    expect(screen.getByText('Neu laden')).toBeInTheDocument();
    expect(screen.getByText('Bug-Report senden')).toBeInTheDocument();

    // Original child content must NOT be present
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
  });
});
