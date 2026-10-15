// The Morning email chip in the header and its dialog (public/js/wc-bell.js openMail): a preview of the email, the sections it sends, when
// it goes and whether to skip empty days. Reads /api/work/mail and /api/work/mail/preview; saves with PUT /api/work/mail. Send me a test
// sends one email to the person's own address.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { asParam, wcApi, wcPost, wcPut } from './api';
import { toast } from './engine';
import { mailQuery, type MailPrefs } from './queries';
import { Ic } from './ui';
import { useMounted } from '../../record/lib';

const SEND: [string, string][] = [
  ['7:30', '7:30 AM'],
  ['8:00', '8:00 AM'],
  ['off', 'Off'],
];
export const mailChipText = (m: MailPrefs | undefined) => (m ? (m.prefs.send_time === 'off' ? 'Off' : m.prefs.send_time === '8:00' ? '8:00 AM' : '7:30 AM') : '');

export function MailChip() {
  const as = typeof location === 'undefined' ? '' : asParam();
  const q = useQuery({ ...mailQuery(as || undefined), retry: false });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(location.search).get('morning') === '1') {
      const t = setTimeout(() => setOpen(true), 900);
      return () => clearTimeout(t);
    }
  }, []);
  // The preference streams in after the server draws: the pill shows only after mount, so the server HTML matches (React 418).
  const mounted = useMounted();
  if (!mounted || !q.data) return null;
  return (
    <>
      <button type="button" className="wc-pill wc-pill--btn" data-wm-mailchip="" onClick={() => setOpen(true)}>
        <Ic n="mail" />
        Morning email <b>{mailChipText(q.data)}</b>
      </button>
      {open ? <MailDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function MailDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const key = mailQuery(asParam() || undefined).queryKey;
  const q = useQuery(mailQuery(asParam() || undefined));
  const v = q.data;
  const [subj, setSubj] = useState('Building your email…');
  const [html, setHtml] = useState('');
  const [sending, setSending] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ret = useRef<HTMLElement | null>(null);
  useEffect(() => {
    ret.current = document.activeElement as HTMLElement | null;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', k, true);
    return () => {
      document.removeEventListener('keydown', k, true);
      try {
        ret.current?.focus();
      } catch {
        // gone
      }
    };
  }, [onClose]);
  const preview = () => {
    wcApi<{ subject: string; html: string }>('/api/work/mail/preview')
      .then((pv) => {
        setSubj(pv.subject);
        setHtml(pv.html.replace('<html>', '<html><head><base target="_blank"></head>'));
      })
      .catch((e: Error) => setSubj('The preview did not load. ' + e.message));
  };
  useEffect(preview, []);
  const save = (patch: { sections?: Record<string, boolean>; send_time?: string; skip_empty?: boolean }) => {
    if (!v) return;
    const p = { sections: { ...v.prefs.sections, ...(patch.sections || {}) }, send_time: patch.send_time ?? v.prefs.send_time, skip_empty: patch.skip_empty ?? v.prefs.skip_empty };
    qc.setQueryData(key, { ...v, prefs: p });
    wcPut<MailPrefs>('/api/work/mail', p)
      .then((nv) => qc.setQueryData(key, nv))
      .catch((e: Error) => toast(e.message));
    clearTimeout(t.current);
    t.current = setTimeout(preview, 250);
  };
  const test = async () => {
    setSending(true);
    try {
      const out = await wcPost<{ to: string }>('/api/work/mail/test', {});
      toast('Sent to ' + out.to + '. It can take a minute.');
    } catch (e) {
      toast((e as Error).message);
    }
    setSending(false);
  };
  const p = v?.prefs;
  const when = !p ? '' : p.send_time === 'off' ? 'Off. You will not get it until you turn it on.' : 'Weekdays at ' + (p.send_time === '8:00' ? '8:00' : '7:30') + ' AM to ' + v!.email;
  let note: { cls: string; text: string } | null = null;
  if (v && v.group && !v.live) {
    note = {
      cls: 'wm-note',
      text: v.from
        ? v.groupLabel + ' start getting this email on ' + new Date(v.from + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }) + '. Until then nothing is sent to you. Send me a test shows how it will look.'
        : v.groupLabel + ' are not on the morning email yet. Send me a test shows how it will look.',
    };
  } else if (v && v.group && v.live) note = { cls: 'wm-note wm-note--ok', text: 'You are on the morning email. It skips weekends.' };
  return createPortal(
    <>
      <div className="wm-scrim" onClick={onClose} />
      <div className="wm-dlg wm-dlg--wide" role="dialog" aria-modal="true" aria-label="Morning email">
        <div className="wm-dlg__head">
          <div>
            <h2>Morning email</h2>
            <p>{when}</p>
          </div>
          <button type="button" className="wm-x" aria-label="Close" onClick={onClose}>
            <Ic n="x" />
          </button>
        </div>
        <div className="wm-dlg__body">
          <div className="wm-mail">
            <div className="wm-client">
              <div className="wm-client__head">
                <div className="subj">{subj}</div>
                <div>
                  <b>Favor International</b> &lt;noreply@mail.favorintl.org&gt;
                </div>
                <div>
                  To: {v?.name} &middot; {v?.email}
                </div>
              </div>
              <iframe className="wm-frame" title="Preview of your morning email" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={html} />
            </div>
            {v && p ? (
              <div className="wm-setts">
                <h3>What it sends</h3>
                <div className="wm-secs">
                  {v.sections.map((s) => (
                    <label key={s.key} className="wm-check">
                      {s.label}
                      <input type="checkbox" className="wm-switch" checked={!!p.sections[s.key]} onChange={(e) => save({ sections: { [s.key]: e.target.checked } })} />
                    </label>
                  ))}
                </div>
                <h3>When</h3>
                <div className="wm-seg" role="group" aria-label="When">
                  {SEND.map(([k, l]) => (
                    <button key={k} type="button" className={p.send_time === k ? 'is-on' : ''} aria-pressed={p.send_time === k} onClick={() => save({ send_time: k })}>
                      {l}
                    </button>
                  ))}
                </div>
                <label className="wm-check">
                  Skip days with nothing due
                  <input type="checkbox" className="wm-switch" checked={!!p.skip_empty} onChange={(e) => save({ skip_empty: e.target.checked })} />
                </label>
                <button type="button" className="h-btn h-btn--ghost h-btn--sm" disabled={sending} onClick={() => void test()}>
                  <Ic n="send" />
                  {sending ? 'Sending…' : 'Send me a test'}
                </button>
                {note ? <div className={note.cls}>{note.text}</div> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
