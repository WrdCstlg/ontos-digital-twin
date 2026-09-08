import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-screen w-full flex-col items-center justify-center bg-bg-base p-6 text-center text-text-primary">
          <div className="w-full max-w-lg rounded-2xl border border-risk/30 bg-bg-panel p-8 shadow-2xl backdrop-blur-xl">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-risk/10 text-risk">
              <AlertTriangle className="size-7" />
            </div>
            <h1 className="mt-5 font-display text-2xl font-bold text-text-primary">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-text-secondary">
              An unexpected client runtime exception occurred. The error has been isolated by the application boundary.
            </p>

            {this.state.error && (
              <div className="mt-5 max-h-40 overflow-auto rounded-lg border border-border-hairline bg-bg-inset p-3 text-left font-mono text-xs text-risk/90">
                {this.state.error.message}
              </div>
            )}

            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="inline-flex items-center gap-2 rounded-xl bg-iris px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-iris/25 transition-all hover:bg-iris-deep active:scale-95"
              >
                <RotateCcw className="size-4" />
                Reload Application
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
