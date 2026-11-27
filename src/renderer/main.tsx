import { render } from 'solid-js/web';
import App from './App';
import './styles/globals.css';
import './styles/glass.css';
import './styles/theme-light.css';
import './styles/animations.css';
import { initThemeSync } from './theme';

initThemeSync();

const root = document.getElementById('root');

if (root) {
  render(() => <App />, root);
}
