// Clips > Edit (/clips/edit/?id=<clip id>): trim, cut, split, delete words, take out silences and filler words. The edits are saved as a
// list; the recording itself is never rewritten. The editor (timeline, waveform, transcript, player) is public/js/clips/editor.js carried
// over as engine/editor.js and runs in the box below once the page is on screen. It loads on its own, so the route's first script stays small.
import { useEffect, useRef } from 'react';
import '@hub/styles/clipedit.css';

// The box the editor draws into. React never touches what is inside it after the first paint.
const OPENING = '<div class="ce-loading" id="ce-loading" role="status"><i></i>Opening the editor</div>';

export function EditorPage({ id }: { id: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let close: (() => void) | null = null;
    let gone = false;
    import('./engine/editor.js').then((m) => {
      if (!gone) close = m.mountEditor(el, id);
    });
    return () => {
      gone = true;
      if (close) close();
    };
  }, [id]);
  return <div className="ce" id="ce" aria-busy="true" ref={box} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: OPENING }} />;
}
