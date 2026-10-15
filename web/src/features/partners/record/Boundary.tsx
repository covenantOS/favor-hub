// A small error boundary for a part of the partner view: the part shows its own short message and the rest keeps working.
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** What the part shows when a read failed. */
  fallback: (error: Error, retry: () => void) => ReactNode;
}
export class Boundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[partner]', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return this.props.fallback(this.state.error, () => this.setState({ error: null }));
  }
}
