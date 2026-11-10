// Catches anything a 3D scene throws (a missing model, a failed chunk, a shader error) so the page
// carries on with its illustrated stand-in instead.

import { Component, type ReactNode } from 'react';

export class SceneBoundary extends Component<{ onError: () => void; label?: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    console.warn(`[${this.props.label ?? '3D'}] scene unavailable, showing the illustrated version.`, error);
    this.props.onError();
  }
  render() { return this.state.failed ? null : this.props.children; }
}
