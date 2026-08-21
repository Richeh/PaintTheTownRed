import './styles.css';
import { createApp } from 'vue';
import App from './App.vue';

// Vue now owns the web client's UI and state. The map renderer and Supabase
// data modules remain framework-agnostic so they can be reused elsewhere.
createApp(App).mount('#app');
