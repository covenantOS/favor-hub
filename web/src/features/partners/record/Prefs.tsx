// Communication preferences on the record: the banner that shows before anyone calls, writes or mails, and the section that lists each
// channel with the solicit code or flag behind it and lets a person with the right turn it on or off. The reading is shared/commprefs.ts;
// the server sends it as p.comm. A change goes through the same batch route as the Codes tab (saved, sent to Blackbaud, read back, undone
// from the toast), then the partner reads again.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CHANNEL_LABEL, KIND_CHANNEL, type Channel, type ChannelKey } from '@shared/commprefs';
import { useIsAdmin } from './admin';
import { todayEt, type Partner } from './lib';
import { partnerQuery } from './queries';
import { runBatch } from './writes';

const DO_NOT: Record<ChannelKey, string> = { call: 'Do Not Call', email: 'Do Not Email', mail: 'Do Not Mail', text: 'Do Not Text' };

type Comm = {
  channels: Channel[];
  banner: { show: boolean; lines: string[]; blocked: ChannelKey[] };
  codes: { id: string; code: string; start: string }[];
  read: boolean;
  requestsNoEmail: boolean;
  noValidAddress: boolean;
};

export const commOf = (p: Partner): Comm | null => ((p as unknown as { comm?: Comm }).comm || null);

/** The strip at the top of the record. Names each blocked channel and why, then the narrowing marks. */
export function CommBanner({ p, kind }: { p: Partner; kind?: string }) {
  const admin = useIsAdmin();
  const c = commOf(p);
  if (!admin || !c || !c.banner.show) return null;
  const want = kind ? KIND_CHANNEL[kind] : undefined;
  if (kind && !want) return null;
  const chans = c.channels.filter((x) => (want ? x.key === want : x.state !== 'ok'));
  if (want && chans[0]?.state === 'ok') return null;
  return (
    <div className={'pp-comm' + (kind ? ' pp-comm--inline' : '')} role="status" data-comm-banner={kind || 'top'}>
      <span className="pp-comm__k">{kind ? CHANNEL_LABEL[want!] + ' marked' : 'Contact marks'}</span>
      {chans.map((x) => (
        <p key={x.key} className={'pp-comm__row is-' + x.state}>
          <b>{x.state === 'blocked' ? 'Do not ' + x.label.toLowerCase() : x.label}</b>
          <small>{x.reasons.map((r) => r.text).join(' · ')}</small>
        </p>
      ))}
    </div>
  );
}

/** The section on the Overview: one row per channel, with a switch where a solicit code or the email flag sets it. */
export function CommPrefs({ p, as, goTab }: { p: Partner; as: string; goTab: (tab: string) => void }) {
  const c = commOf(p);
  const qc = useQueryClient();
  const [busy, setBusy] = useState('');
  const admin = useIsAdmin();
  if (!admin || !c) return null;
  const can = !!(p as unknown as { canCodes?: boolean }).canCodes;
  const reread = () => qc.invalidateQueries({ queryKey: partnerQuery(p.id, as).queryKey });
  const flip = async (ch: Channel) => {
    if (busy) return;
    setBusy(ch.key);
    const blockers = ch.reasons.filter((r) => r.code && ch.state === 'blocked');
    let ok: string | boolean = false;
    if (ch.state === 'blocked' && (blockers.length || ch.reasons.some((r) => r.flag))) {
      // Allow: end every code that blocks the channel, then clear the email flag when that is the cause.
      for (const r of blockers) {
        const row = c.codes.find((x) => x.code === r.code);
        if (!row) continue;
        ok = await runBatch({ op: 'psolicit', cid: p.id, mode: 'end', id: row.id, date: todayEt() }, r.code + ' ended');
        if (!ok) break;
      }
      if (ok !== false && ch.reasons.some((r) => r.flag === 'requestsNoEmail')) ok = await runBatch({ op: 'pflags', cid: p.id, flags: { requestsNoEmail: false } }, 'Requests no email cleared');
    } else if (ch.state !== 'blocked') {
      ok = await runBatch({ op: 'psolicit', cid: p.id, mode: 'add', code: DO_NOT[ch.key], date: todayEt() }, DO_NOT[ch.key] + ' added');
    }
    setBusy('');
    if (ok) await reread();
  };
  // A block with no solicit code or editable flag behind it (a phone, email or address mark) is changed on the Contact tab.
  const editable = (ch: Channel) => ch.state !== 'blocked' || ch.reasons.every((r) => !!r.code || r.flag === 'requestsNoEmail');
  return (
    <section className="pp-sec pp-prefs" aria-label="Communication preferences">
      <h3>
        <span>Communication preferences</span>
        <button type="button" onClick={() => goTab('codes')}>
          Solicit codes
        </button>
      </h3>
      <div className="pp-prefs__list">
        {c.channels.map((ch) => (
          <div key={ch.key} className={'pp-prefs__row is-' + ch.state}>
            <div>
              <b>{ch.label}</b>
              <small>{ch.state === 'ok' ? 'No mark' : ch.reasons.map((r) => r.text).join(' · ')}</small>
            </div>
            {editable(ch) ? (
              <label className="rc-tog">
                <input type="checkbox" checked={ch.state === 'blocked'} disabled={!can || !!busy} onChange={() => void flip(ch)} aria-label={'Do not ' + ch.label.toLowerCase()} />
                <i />
                <span>Do not {ch.label.toLowerCase()}</span>
              </label>
            ) : (
              <button type="button" className="pp-edit" onClick={() => goTab('contact')}>
                Edit on Contact
              </button>
            )}
          </div>
        ))}
      </div>
      {!c.read ? <p className="pp-empty">Solicit codes for this record have not been read from Blackbaud yet.</p> : null}
    </section>
  );
}
