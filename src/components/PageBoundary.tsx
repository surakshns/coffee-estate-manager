import { Component, type ReactNode } from 'react'

export class PageBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean; route: string }> {
  state = { failed: false, route: this.props.resetKey }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { route: string }) {
    return props.resetKey !== state.route ? { failed: false, route: props.resetKey } : null
  }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <section className="page workspace-page"><div className="workspace-empty" role="alert"><h1>This screen could not be opened</h1><p>Reload the app to get the latest version and try again.</p><button className="button-primary" onClick={() => window.location.reload()}>Reload app</button></div></section>
  }
}
