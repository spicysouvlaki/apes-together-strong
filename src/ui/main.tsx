/**
 * App entry (index.html). Styles, worker wiring, then the Preact tree.
 */
import { render } from 'preact';
import './styles/fonts';
import './styles/base.css';
import './styles/shell.css';
import './styles/moments.css';
import { App } from './App';
import { initApp } from './app-wiring';
import * as store from './store';

initApp();
const root = document.getElementById('app');
if (root) render(<App />, root);

// Dev-only handle for browser debugging (read signals, dispatch). Stripped from production builds.
if (import.meta.env.DEV) (window as unknown as { __apes: typeof store }).__apes = store;
