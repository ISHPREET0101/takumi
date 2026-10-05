import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Keeps one page-level crash from blanking the whole app. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="banner error" style={{ margin: "20px 0" }}>
          <strong>Something went wrong rendering this page.</strong>
          <div className="small">{this.state.error.message}</div>
          <div className="btn-row">
            <button className="btn" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button className="btn ghost" onClick={() => (window.location.href = "/#/capture")}>
              Back to Capture
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
