// Admin > Gifts (/admin/gifts/): who opens Gift entry and who sends deposits to Blackbaud, the amount that needs a second approver, whether Online gifts
// writes approved designations to Blackbaud, and who sees Other gifts. Port of public/js/admin-gifts.js with the same markup, words and calls.
import { useState } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/admin.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import { hubSend } from '../../lib/write';
import {
  giftEntrySettingsQuery,
  onlineGiftsSettingQuery,
  otherGiftsSettingsQuery,
  type GiftEntrySettings,
  type OnlineGiftsSetting,
  type OtherGiftsSetting,
} from './api';
import { AdminPage } from './AdminPage';
import { money } from './format';
import { secondDollars } from './gifts';

const OTHER_MODES: Array<[string, string]> = [
  ['off', 'Off (staff do not see it)'],
  ['admins', 'Admins only'],
  ['on', 'Everyone who opens Gift entry'],
];

function GiftEntryCard({ say }: { say: (m: string) => void }) {
  const qc = useQueryClient();
  const { data: ge } = useSuspenseQuery(giftEntrySettingsQuery);
  // A checkbox flips at once and settles on what the server answers (or goes back when the save fails).
  const [flip, setFlip] = useState<Record<string, boolean>>({});
  const [pick, setPick] = useState('');
  const [sec, setSec] = useState<string | null>(null);
  const put = (body: Record<string, unknown>) => hubSend('/api/gift-entry/settings', 'PUT', body, (d) => d as GiftEntrySettings);
  const done = (r: GiftEntrySettings) => {
    qc.setQueryData(giftEntrySettingsQuery.queryKey, r);
    setFlip({});
    setSec(null);
  };
  const failed = (e: Error) => {
    say(e.message);
    setFlip({});
    void qc.invalidateQueries({ queryKey: giftEntrySettingsQuery.queryKey });
  };
  if (!ge)
    return (
      <section className="ad-card">
        <h2>Gift entry</h2>
        <p className="ad-note">Who opens Gift entry, Online gifts and Receipts, and who may send a deposit to Blackbaud. Sending is never implied by a role.</p>
        <p className="ad-msg ad-msg--bad">Gift entry settings did not load.</p>
      </section>
    );
  const toggle = (email: string, field: 'access' | 'posting', checked: boolean) => {
    setFlip((f) => ({ ...f, [email + '|' + field]: checked }));
    put({ email, [field]: checked })
      .then((r) => {
        say('Saved.');
        done(r);
      })
      .catch(failed);
  };
  const value = (email: string, field: 'access' | 'posting', real: boolean) => (flip[email + '|' + field] !== undefined ? flip[email + '|' + field] : real);
  return (
    <section className="ad-card">
      <h2>Gift entry</h2>
      <p className="ad-note">Who opens Gift entry, Online gifts and Receipts, and who may send a deposit to Blackbaud. Sending is never implied by a role.</p>
      <div className="ad-scroll">
        <table className="ad-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Gift entry</th>
              <th>Blackbaud</th>
            </tr>
          </thead>
          <tbody>
            {ge.people.length ? (
              ge.people.map((p) => (
                <tr key={p.email}>
                  <td>{p.name}</td>
                  <td>{p.role === 'admin' ? 'Admin' : 'Access given'}</td>
                  <td>
                    {p.role === 'admin' ? (
                      <span className="ad-muted">Always</span>
                    ) : (
                      <label className="ad-chk">
                        <input type="checkbox" data-pp="access" data-email={p.email} checked={value(p.email, 'access', p.access)} onChange={(e) => toggle(p.email, 'access', e.target.checked)} /> Opens Gift entry
                      </label>
                    )}
                  </td>
                  <td>
                    <label className="ad-chk">
                      <input type="checkbox" data-pp="posting" data-email={p.email} checked={value(p.email, 'posting', p.posting)} onChange={(e) => toggle(p.email, 'posting', e.target.checked)} /> Sends to Blackbaud
                    </label>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4}>No one yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="ad-sub">
        <select className="ad-field" id="ag-add" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Add a person</option>
          {ge.candidates.map((c) => (
            <option key={c.email} value={c.email}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ad-btn"
          data-add
          onClick={() => {
            if (!pick) return;
            put({ email: pick, access: true })
              .then((r) => {
                say('Access given.');
                setPick('');
                done(r);
              })
              .catch((e: Error) => say(e.message));
          }}
        >
          Give access
        </button>
      </div>
      <div className="ad-sub">
        <label className="ad-lbl">
          Second approval from, in dollars (0 is off){' '}
          <input className="ad-field" id="ag-sec" inputMode="decimal" value={sec ?? (ge.second ? (ge.second / 100).toFixed(2) : '0')} onChange={(e) => setSec(e.target.value)} />
        </label>
        <button
          type="button"
          className="ad-btn"
          data-sec
          onClick={() => {
            put({ secondDollars: secondDollars(sec ?? (ge.second ? (ge.second / 100).toFixed(2) : '0')) })
              .then((r) => {
                say(r.second ? 'Second approval from ' + money(r.second) + '.' : 'Second approval is off.');
                done(r);
              })
              .catch((e: Error) => say(e.message));
          }}
        >
          Save
        </button>
        <span className="ad-muted">{ge.second ? 'Now ' + money(ge.second) : 'Now off'}</span>
      </div>
    </section>
  );
}

/** The Online gifts switch is read in the browser only (an empty POST), so the card holds its place until the answer comes. */
function OnlineCard({ say }: { say: (m: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery(onlineGiftsSettingQuery);
  if (q.isPending)
    return (
      <section className="ad-card" aria-busy="true">
        <h2>Online gifts</h2>
        <p className="ad-note">When writes are on, an approved change of designation goes to Blackbaud. Off records the approval in FavorOS only.</p>
        <div className="ad-sub" style={{ minHeight: 40 }} />
      </section>
    );
  const og = q.data as OnlineGiftsSetting | null | undefined;
  return (
    <section className="ad-card">
      <h2>Online gifts</h2>
      <p className="ad-note">When writes are on, an approved change of designation goes to Blackbaud. Off records the approval in FavorOS only.</p>
      {og ? (
        <div className="ad-sub">
          <span>
            Writes to Blackbaud: <b>{og.apply ? 'On' : 'Off'}</b> · {og.testLimit ? 'only record ' + og.testLimit : 'every record'}
          </span>
          <button
            type="button"
            className="ad-btn"
            data-og
            onClick={() => {
              const on = og.apply;
              if (!on && !confirm('Approved changes of designation will go to Blackbaud' + (og.testLimit ? ' for record ' + og.testLimit + ' only' : ' for every record') + '. Turn writes on?')) return;
              hubSend('/api/online-gifts/setting', 'POST', { apply: on ? 'off' : 'on' }, (d) => d as OnlineGiftsSetting)
                .then((r) => {
                  qc.setQueryData(onlineGiftsSettingQuery.queryKey, r);
                  say('Writes are ' + (r.apply ? 'on' : 'off') + '.');
                })
                .catch((e: Error) => say(e.message));
            }}
          >
            Turn {og.apply ? 'off' : 'on'}
          </button>
        </div>
      ) : (
        <p className="ad-msg ad-msg--bad">The Online gifts setting did not load.</p>
      )}
    </section>
  );
}

function OtherCard({ say }: { say: (m: string) => void }) {
  const qc = useQueryClient();
  const { data: ot } = useSuspenseQuery(otherGiftsSettingsQuery);
  const [mode, setMode] = useState<string | null>(null);
  return (
    <section className="ad-card">
      <h2>Other gifts</h2>
      <p className="ad-note">
        DAF, foundation, wire, stock and phone gifts entered in FavorOS with the soft credit, in a batch a second person approves. Approving posts the gifts to Blackbaud. Off hides the page from staff. Will and the test
        accounts always see it.
      </p>
      {ot ? (
        <div className="ad-sub">
          <label className="ad-lbl">
            Who sees it{' '}
            <select className="ad-field" id="ot-mode" value={mode ?? ot.mode} onChange={(e) => setMode(e.target.value)}>
              {OTHER_MODES.map((o) => (
                <option key={o[0]} value={o[0]}>
                  {o[1]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ad-btn"
            data-ot
            onClick={() => {
              const m = mode ?? ot.mode;
              if (m !== 'off' && !confirm('Staff will see Other gifts and a second person can approve batches that post gifts to Blackbaud. Michael has to agree to the new entry first. Turn it on?')) return;
              hubSend('/api/other-gifts/settings', 'PUT', { mode: m }, (d) => d as OtherGiftsSetting)
                .then((r) => {
                  qc.setQueryData(otherGiftsSettingsQuery.queryKey, r);
                  setMode(null);
                  say('Other gifts is ' + r.mode + '.');
                })
                .catch((e: Error) => say(e.message));
            }}
          >
            Save
          </button>
          <span className="ad-muted">Now {ot.mode}</span>
        </div>
      ) : (
        <p className="ad-msg ad-msg--bad">The Other gifts setting did not load.</p>
      )}
    </section>
  );
}

const Wait = () => (
  <div className="ad" data-ad-gifts="" aria-busy="true">
    <div className="ad-tile h-skel" style={{ minHeight: 360 }} />
  </div>
);

function Body() {
  // One line under the cards says what the last action did, as the classic page's S.msg does.
  const [msg, setMsg] = useState('');
  return (
    <div className="ad" data-ad-gifts="">
      <GiftEntryCard say={setMsg} />
      <OnlineCard say={setMsg} />
      <OtherCard say={setMsg} />
      {msg ? (
        <p className="ad-msg" role="status">
          {msg}
        </p>
      ) : null}
    </div>
  );
}

export function GiftsSettingsPage() {
  return (
    <AdminPage on="gifts" title="Gifts" wait={<Wait />} failArea="data-ad-gifts">
      <Body />
    </AdminPage>
  );
}
