import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import { rendererLog } from '../lib/log';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<PropsWithChildren, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Both, and neither is redundant: the console is where the developer is looking while it happens.
    console.error('[ErrorBoundary]', error, info.componentStack);
    rendererLog.error('[renderer] crash', error);
  }

  override render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: '32px',
            // Inline, потому что это экран на случай, когда упало всё остальное, — включая, возможно, и таблицу стилей.
            fontFamily: 'Inter, system-ui, sans-serif',
            color: '#eaeaea',
            background: '#141414',
            minHeight: '100vh',
            whiteSpace: 'pre-wrap',
          }}
        >
          <h2 style={{ color: '#ea4c4c', marginBottom: 16 }}>Renderer crash</h2>
          <div style={{ color: '#00ba78', marginBottom: 12 }}>{this.state.error.message}</div>
          <pre style={{ font: 'inherit', fontSize: 14, opacity: 0.8 }}>
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
