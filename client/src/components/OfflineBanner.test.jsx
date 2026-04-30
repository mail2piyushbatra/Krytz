import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { OfflineBanner } from './OfflineBanner';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as ToastModule from './Toast';

vi.mock('./Toast', () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn()
  })
}));

describe('OfflineBanner', () => {
  let onlineGetter;

  beforeEach(() => {
    onlineGetter = vi.spyOn(window.navigator, 'onLine', 'get');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not render when online initially', () => {
    onlineGetter.mockReturnValue(true);
    render(<OfflineBanner />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders when offline initially', () => {
    onlineGetter.mockReturnValue(false);
    render(<OfflineBanner />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/No internet connection/i)).toBeInTheDocument();
  });

  it('appears when going offline and disappears when coming online', () => {
    onlineGetter.mockReturnValue(true);
    const { unmount } = render(<OfflineBanner />);
    
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Trigger offline event
    act(() => {
      onlineGetter.mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Trigger online event
    act(() => {
      onlineGetter.mockReturnValue(true);
      window.dispatchEvent(new Event('online'));
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    
    unmount();
  });
});
