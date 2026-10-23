import { Component, type ErrorInfo, type ReactNode } from 'react';

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.debug('App rendering failed', error, info.componentStack);
  }

  override render() {
    if (this.state.failed) {
      return (
        <main className='mx-auto max-w-lg space-y-3 p-6'>
          <h1 className='text-xl font-bold text-gold'>
            This page could not be displayed
          </h1>
          <p>Your saved draft is kept in this browser. Reload to try again.</p>
          <a
            href={window.location.href}
            className='action-link'
          >
            Reload page
          </a>
          <a
            href='/'
            className='ml-3 underline'
          >
            Home
          </a>
        </main>
      );
    }
    return this.props.children;
  }
}

export default AppErrorBoundary;
