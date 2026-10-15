// The Clips recorder window (/clips/rec/). The hub's camera button opens this page in a small window of its own, so a recording lives
// outside any hub page: going to another page, reloading or switching tabs in the hub never touches it. Port of src/pages/clips/rec.astro.
// The recorder (screen, camera, microphone, countdown, bubble, floating controls, upload) is public/js/clips/launcher.js and the modules
// it uses, unchanged. It loads here after the page paints, so this route's own script stays tiny and a recording never waits on the rest.
import { useEffect } from 'react';

export function RecorderPage() {
  useEffect(() => {
    let off = false;
    import('@clips/launcher.js').then((m: { openLauncher: (anchor: HTMLElement | null) => void }) => {
      // openLauncher toggles, so a second call (a reload of this effect) must not close the card the first one opened.
      if (!off && !document.getElementById('cr-card')) m.openLauncher(null);
    });
    return () => {
      off = true;
    };
  }, []);
  return <main id="cr-root" suppressHydrationWarning />;
}
