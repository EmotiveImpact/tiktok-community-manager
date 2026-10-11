import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initTheme } from './lib/theme';
import { installBridgeMock } from './lib/bridge-mock';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TooltipProvider } from './components/ui';
import { LiveLensConsole } from './pages/LiveLensConsole';

// Browser dev mode: the Electron preload bridge is absent, install a demo mock.
const communityView = new URLSearchParams(window.location.search).has('page');
if (communityView && typeof window.tiktok === 'undefined') {
  installBridgeMock();
}

initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        {communityView ? <App /> : <LiveLensConsole />}
      </TooltipProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
