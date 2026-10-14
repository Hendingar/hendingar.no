import { mount } from 'svelte';
import '../styles/brand.css';
import EventsView from './EventsView.svelte';

/**
 * Entry point of the MCP App view. Not part of the SvelteKit app: `server/mcp/view-plugin.ts`
 * bundles this file and everything it imports into one inline script, served as the
 * `ui://hendingar/events.html` resource. brand.css comes along so the cards are the site's own.
 */
const target = document.getElementById('app');
if (target) mount(EventsView, { target });
