import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** What the card says when it breaks, in the page's own words: "The meetings card could not load." */
  label?: string;
  /** A card sized like the one it replaces, so the page does not jump. */
  className?: string;
  onError?: (error: Error) => void;
}

interface State {
  error: Error | null;
}

/** One per card. A card that throws shows a short message and a retry; the rest of the page and the shell keep working. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[card]', this.props.label || 'card', error, info.componentStack);
    this.props.onError?.(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={this.props.className || 'h-card r2t-clear'} role="alert">
        {this.props.label || 'This part of the page could not load.'}{' '}
        <button type="button" className="h-link" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
