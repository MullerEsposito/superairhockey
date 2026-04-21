import React from 'react';
import HomePage from './pages/HomePage';
import HostPage from './pages/HostPage';
import ControllerPage from './pages/ControllerPage';
import SpectatorPage from './pages/SpectatorPage';

function resolvePage(pathname) {
  if (pathname === '/host' || pathname === '/host.html') return 'host';
  if (pathname === '/controller' || pathname === '/controller.html') return 'controller';
  if (pathname === '/spectator' || pathname === '/spectator.html') return 'spectator';
  return 'home';
}

export default function App() {
  const page = resolvePage(window.location.pathname);

  if (page === 'host') return <HostPage />;
  if (page === 'controller') return <ControllerPage />;
  if (page === 'spectator') return <SpectatorPage />;
  return <HomePage />;
}
