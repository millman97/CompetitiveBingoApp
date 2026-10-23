import AppErrorBoundary from './error/AppErrorBoundary';
import Router from './routing/Router';

const App = () => (
  <AppErrorBoundary>
    <Router />
  </AppErrorBoundary>
);

export default App;
