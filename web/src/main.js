import './styles.css';
import { ensureAnonymousSession } from './supabase.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="app-shell">
    <header class="app-header">
      <div>
        <p class="eyebrow">Collaborative map</p>
        <h1>Town Red</h1>
      </div>
      <span id="connection-status" class="status-pill">Starting…</span>
    </header>

    <section class="map-shell" aria-labelledby="map-heading">
      <div class="map-placeholder">
        <div>
          <h2 id="map-heading">Map coming next</h2>
          <p>
            The frontend, dev server and Supabase session are now wired. The next step is to mount the standalone map renderer here.
          </p>
        </div>
      </div>
    </section>

    <footer class="app-footer">
      <span id="identity-status">Connecting to Supabase…</span>
    </footer>
  </main>
`;

const connectionStatus = document.querySelector('#connection-status');
const identityStatus = document.querySelector('#identity-status');

async function bootstrap() {
  try {
    const session = await ensureAnonymousSession();
    const userId = session?.user?.id;

    connectionStatus.textContent = 'Connected';
    connectionStatus.dataset.state = 'connected';
    identityStatus.textContent = userId
      ? `Anonymous session ${userId.slice(0, 8)}…`
      : 'Anonymous session established';
  } catch (error) {
    console.error('[Town Red] bootstrap failed', error);
    connectionStatus.textContent = 'Connection error';
    connectionStatus.dataset.state = 'error';
    identityStatus.textContent = error instanceof Error ? error.message : String(error);
  }
}

bootstrap();
