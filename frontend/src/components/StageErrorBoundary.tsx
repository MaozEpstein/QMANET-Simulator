/**
 * React error boundary that catches render errors inside one Stage so the
 * rest of the app keeps working. A "↻ נסה שוב" button resets the boundary's
 * internal state and re-renders the children, giving the user a way to
 * recover without reloading the entire page.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { palette } from "../theme/palette";

interface Props {
  children: ReactNode;
  /** Logical name of the stage — appears in the fallback UI. */
  stageName: string;
}

interface State {
  error: Error | null;
}

export class StageErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface in the dev console so the developer can debug.
    // eslint-disable-next-line no-console
    console.error(
      `[StageErrorBoundary:${this.props.stageName}]`,
      error,
      info.componentStack,
    );
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          style={{
            background: palette.bgPanel,
            border: `1px solid ${palette.err}`,
            borderRadius: 12,
            padding: 24,
          }}
        >
          <h2
            style={{
              margin: "0 0 10px",
              color: palette.err,
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            תקלה בשלב "{this.props.stageName}"
          </h2>
          <div style={{ color: palette.textSecondary, fontSize: 13 }}>
            הרכיב קרס בזמן הרינדור. שאר הממשק נשאר פעיל; ניתן לעבור לשלב אחר או לנסות שוב.
          </div>
          <pre
            style={{
              marginTop: 14,
              padding: 12,
              background: palette.bgInset,
              borderRadius: 8,
              color: palette.err,
              fontSize: 12,
              fontFamily: "JetBrains Mono, monospace",
              overflow: "auto",
              maxHeight: 200,
              whiteSpace: "pre-wrap",
            }}
            dir="ltr"
            data-testid="error-message"
          >
            {this.state.error.name}: {this.state.error.message}
            {this.state.error.stack && `\n\n${this.state.error.stack}`}
          </pre>
          <button
            onClick={this.reset}
            style={{
              marginTop: 14,
              padding: "8px 16px",
              background: palette.queraPurple,
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ↻ נסה שוב
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
