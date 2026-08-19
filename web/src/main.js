import './styles.css';
import { ensureAnonymousSession } from './supabase.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="grid min-h-screen grid-rows-[auto_1fr_auto] bg-stone-50 text-stone-900">
    <header class="flex items-center justify-between gap-4 border-b border-stone-200 bg-white/90 px-5 py-4 backdrop-blur">
      <div>
        <p class="mb-0.5 text-xs font-bold uppercase tracking-[0.08em] text-red-800">Collaborative map</p>
        <h1 class="m-0 text-2xl font-bold tracking-tight sm:text-3xl">Town Red</h1>
      </div>
      <span
        id="connection-status"
        class="shrink-0 rounded-full border border-stone-300 bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-600"
      >Starting…</span>
    </header>

    <section class="min-h-0 p-4" aria-labelledby="map-heading">
      <div class="grid min-h-[calc(100vh-10rem)] place-items-center rounded-2xl border border-dashed border-stone-300 bg-white text-center shadow-sm">
        <div class="max-w-lg p-8">
          <h2 id="map-heading" class="mb-3 text-xl font-semibold">Map coming next</h2>
          <p class="m-0 leading-7 text-stone-600">
            The frontend, dev server, Tailwind and Supabase session are wired. The next step is to mount the standalone map renderer here.
          </p>
        </div>
      </div>
    </section>

    <footer class="flex items-center justify-between gap-4 border-t border-stone-200 bg-white/90 px-5 py-4 text-sm text-stone-600">
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
    connectionStatus.className = 'shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800';
    identityStatus.textContent = userId
      ? `Anonymous session ${userId.slice(0, 8)}…`
      : 'Anonymous session established';
  } catch (error) {
    console.error('[Town Red] bootstrap failed', error);
    connectionStatus.textContent = 'Connection error';
    connectionStatus.className = 'shrink-0 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800';
    identityStatus.textContent = error instanceof Error ? error.message : String(error);
  }
}

bootstrap();
