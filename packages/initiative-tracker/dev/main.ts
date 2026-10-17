// Demo page: the tracker with its default options (localStorage encounters, built-in SRD list).
import { createTracker } from '../src/index';

const app = document.getElementById('app');
const tracker = createTracker(app);
// Handy in the browser console and for tests.
(window as unknown as { tracker: unknown }).tracker = tracker;
