/**
 * ErrorBoundary — catches render-time exceptions anywhere in the React tree and
 * shows a recovery card instead of a blank white screen.
 *
 * A blank window mid-stream is the worst possible failure for a creator: they
 * can't tell whether the app crashed or the connection dropped. This keeps the
 * window populated and offers a one-click Reload.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to the renderer console so it's captured in devtools / electron-log's
    // renderer transport if wired later.
    // TODO: Sentry.captureException(error, { extra: info })
    console.error('[ErrorBoundary] render error:', error, info.componentStack);
  }

  private reload = () => {
    // Full reload re-mounts the app cleanly; the main process keeps the live
    // connection alive, so a reload doesn't drop the stream.
    location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: 24,
          background: 'var(--bg, #0b0d14)',
          color: 'var(--label, #e6eaf3)',
        }}
      >
        <div
          role="alert"
          style={{
            maxWidth: 440,
            width: '100%',
            borderRadius: 18,
            padding: 28,
            textAlign: 'center',
            background: 'var(--fill-quaternary, rgba(120,134,178,0.08))',
            border: '1px solid var(--card-border, rgba(120,134,178,0.16))',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden>
            ⚠️
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px' }}>Something broke</h1>
          <p style={{ fontSize: 13, color: 'var(--secondary-label, #94a3b8)', margin: '0 0 18px' }}>
            The view hit an unexpected error. Your live connection and saved data are unaffected —
            reload to recover.
          </p>
          {this.state.error?.message && (
            <pre
              style={{
                fontSize: 11,
                textAlign: 'left',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 120,
                overflow: 'auto',
                padding: 10,
                borderRadius: 10,
                marginBottom: 18,
                color: 'var(--secondary-label, #94a3b8)',
                background: 'var(--fill-thin, rgba(0,0,0,0.18))',
                border: '1px solid var(--card-border, rgba(120,134,178,0.16))',
              }}
            >
              {this.state.error.message}
            </pre>
          )}
          <button
            type="button"
            onClick={this.reload}
            className="panel-btn panel-btn-primary"
            style={{ minWidth: 120, justifyContent: 'center' }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
