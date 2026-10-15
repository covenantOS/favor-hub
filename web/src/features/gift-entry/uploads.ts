// The photo upload queue, ported from pump() in public/js/gift-entry.js: two uploads at a time, each tried up to three times when the
// network or the server fails (a 4xx stops at once), the deposit read again after each one. Photos go up as raw JPEG bodies.
import { useCallback, useEffect, useRef, useState } from 'react';
import { geWrites, GeError } from './data';
import { geToast } from './toast';

export interface QueueItem {
  blob: Blob;
  label: string;
  state: 'waiting' | 'sending' | 'done' | 'error';
  tries: number;
  kind: string;
  gift: string;
  dep: string;
  err?: string;
}

export interface Uploads {
  /** What is waiting, sending or failed (done photos leave the queue). */
  items: Pick<QueueItem, 'label' | 'state' | 'err'>[];
  enqueue: (blob: Blob, label: string, kind?: string, gift?: string) => void;
  retry: (index: number) => void;
}

export function useUploads(depositId: string, refresh: () => Promise<unknown>): Uploads {
  const queue = useRef<QueueItem[]>([]);
  const pumping = useRef(0);
  const [items, setItems] = useState<Uploads['items']>([]);
  const refreshRef = useRef(refresh);
  const alive = useRef(true);
  useEffect(() => {
    refreshRef.current = refresh;
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const paint = useCallback(() => {
    if (alive.current) setItems(queue.current.filter((x) => x.state !== 'done').map((x) => ({ label: x.label, state: x.state, err: x.err })));
  }, []);

  const pump = useCallback(async (): Promise<void> => {
    if (pumping.current >= 2) return;
    const item = queue.current.find((x) => x.state === 'waiting');
    if (!item) {
      if (!pumping.current) await refreshRef.current();
      return;
    }
    item.state = 'sending';
    pumping.current++;
    paint();
    try {
      const out = await geWrites.photo(item.dep, item.blob, item.kind, item.gift);
      item.state = 'done';
      if (out.status === 'skipped') geToast('That photo was an envelope and was skipped.');
      else if (out.status === 'retake') geToast('That photo is unreadable. Take it again.');
    } catch (e) {
      item.tries++;
      const status = e instanceof GeError ? e.status : undefined;
      const net = !(e instanceof GeError) && (e as Error).name === 'TypeError';
      if (item.tries < 3 && (status == null || status >= 500 || net)) {
        item.state = 'waiting';
        await new Promise((r) => setTimeout(r, 1500 * item.tries));
      } else {
        item.state = 'error';
        item.err = (e as Error).message;
      }
    } finally {
      pumping.current--;
    }
    queue.current = queue.current.filter((x) => x.state !== 'done');
    paint();
    await refreshRef.current();
    void pump();
  }, [paint]);

  const enqueue = useCallback(
    (blob: Blob, label: string, kind = 'check_front', gift = '') => {
      queue.current.push({ blob, label, state: 'waiting', tries: 0, kind, gift, dep: depositId });
      void pump();
      paint();
    },
    [depositId, pump, paint]
  );

  const retry = useCallback(
    (index: number) => {
      const it = queue.current.filter((x) => x.state !== 'done')[index];
      if (it) {
        it.state = 'waiting';
        it.tries = 0;
        void pump();
        paint();
      }
    },
    [pump, paint]
  );

  return { items, enqueue, retry };
}
