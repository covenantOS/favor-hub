// Clips > the recorder window (/clips/rec/). No frame: a small window of its own that holds the streams, the recorder and the controls.
import { createFileRoute } from '@tanstack/react-router';
import { RecorderPage } from '../../../features/clips/RecorderPage';

const FACES =
  "@font-face{font-family:'Playfair Display';src:url('/fonts/playfair-500.woff2') format('woff2');font-weight:500;font-display:swap}@font-face{font-family:'Inter';src:url('/fonts/inter-var.woff2') format('woff2');font-weight:100 900;font-display:swap}";

export const Route = createFileRoute('/clips/rec/')({
  staticData: { nav: 'clips', title: 'Clip recorder', layout: 'bare', solo: true },
  head: () => ({
    meta: [{ title: 'Clip recorder' }],
    links: [
      { rel: 'stylesheet', href: '/js/clips/launcher.css?v=9' },
      { rel: 'preload', href: '/fonts/inter-var.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
    ],
    styles: [{ children: FACES }],
  }),
  component: RecorderPage,
});
