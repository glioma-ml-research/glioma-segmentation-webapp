import { Component, type ErrorInfo, type ReactNode } from "react";

/** One broken view must not blank the whole site: show what happened and a way out. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("render failed", error, info.componentStack);
  }

  componentDidUpdate(previous: { resetKey: string }) {
    // Navigating elsewhere clears the error.
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="container report-page">
        <div className="report-state">
          <h1>Something went wrong on this page</h1>
          <p>The rest of the site still works. Reloading usually fixes it; if not, go back and open the result again.</p>
          <div className="auth-actions">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <a className="btn btn-secondary" href="/">
              Home
            </a>
          </div>
        </div>
      </main>
    );
  }
}
