/** ✦ Krytz — Error Boundary
 *
 * Catches React render errors and shows a recovery UI
 * instead of killing the entire app.
 */
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught:', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary" role="alert" aria-live="assertive">
          <div className="error-boundary-inner">
            <span className="error-boundary-icon">⚠</span>
            <h2>Something went wrong</h2>
            <p className="error-boundary-msg">{this.state.error?.message || 'An unexpected error occurred.'}</p>
            <div className="error-boundary-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                }}
              >
                Try Again
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => window.location.reload()}
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
