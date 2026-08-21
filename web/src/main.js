import './styles.css';
import { createApp } from 'vue';
import App from './App.vue';
import AuthDock from './components/AuthDock.vue';

// The primary Vue tree owns mapping and collaboration state.
createApp(App).mount('#app');

// Authentication is deliberately isolated from the map state. AuthDock uses
// Vue Teleport to place its controls in the existing header/footer and reloads
// after an identity transition, giving the map a clean Supabase session.
const authRoot = document.createElement('div');
authRoot.id = 'town-red-auth';
document.body.append(authRoot);
createApp(AuthDock).mount(authRoot);
