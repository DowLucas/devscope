import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Last-resort boundary around the whole dashboard. Without it, any render
 * error unmounts the entire React tree and the user is left with a blank page.
 */
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[dashboard] render error", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center p-4">
          <div className="text-center space-y-3">
            <p className="text-gray-400">Something went wrong rendering the dashboard.</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => this.setState({ hasError: false })}
                className="px-4 py-2 text-sm rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700"
              >
                Retry
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-sm rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
