import './styles';
import { useEffect } from 'react';
import { TODAY_FRAME } from '../../../../src/data/today-skeleton';
import { leavePage, runClassicScript } from '@/legacy/page';
import { loadScript } from '@/lib/legacy';

// Today (redesign 2026-10-14) is the classic page's frame and scripts, mounted here so both hosts draw the same page:
// src/data/today-skeleton.ts is the markup, public/js/today3.js fills it, work-home.js and today-giftday.js fill the role modules.
// Helpers that only define functions load once; the scripts that draw run on every visit.
const ONCE = ['/js/today-snooze.js?v=2', '/js/chat/chat-view.js?v=2', '/js/today-inbox.js?v=5', '/js/wc-snap.js?v=2'];
const EACH = ['/js/today3.js?v=2', '/js/today-firstweek.js?v=1', '/js/work-home.js?v=18', '/js/today-giftday.js?v=1'];

/** Today: what needs this person now, their schedule, how Favor is doing, then the modules for their job. */
export function TodayPage() {
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const src of ONCE) await loadScript(src).catch(() => undefined);
      for (const src of EACH) {
        if (!live) return;
        await runClassicScript(src).catch((e) => console.warn('[today]', src, e));
      }
    })();
    return () => {
      live = false;
      leavePage();
    };
  }, []);
  return <div className="td" id="td-root" dangerouslySetInnerHTML={{ __html: TODAY_FRAME }} />;
}
