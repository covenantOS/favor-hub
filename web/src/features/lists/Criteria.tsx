// The criteria card of the Lists builder: six sections of menus. Everything is a menu value; the server checks each one.
import type { ReactNode } from 'react';
import type { Menus } from './api';
import { Check, Chips, DateIn, Field, Multi, Range, Seg, Span, TextList } from './fields';
import type { ListSpec, SectionId } from './spec';

type Opt = [string, string, string?];
const plain = (arr?: string[]): Opt[] => (arr || []).map((v) => [v, v]);

function Section({ id, title, n, open, children }: { id: SectionId; title: string; n: number; open?: boolean; children: ReactNode }) {
  return (
    <details className="ls-sec" data-sec={id} open={open}>
      <summary>
        <span>{title}</span>
        <b className="ls-secn" data-n={id}>
          {n ? String(n) : ''}
        </b>
      </summary>
      {children}
    </details>
  );
}

/** Up to three "gave between" periods, each with its dates and amounts. Adding one does not change the list until something in it is set. */
function Giving({ quiet, set, spec }: { quiet: (path: string, v: unknown) => void; set: (path: string, v: unknown) => void; spec: ListSpec }) {
  const gs = spec.partner.giving;
  return (
    <div className="ls-giving">
      {gs.map((_, i) => {
        const base = 'partner.giving.' + i;
        return (
          <div className="ls-gv" key={i}>
            <span className="ls-fl">Gave between</span>
            <Span path={base} />
            <Range path={base} unit="$" />
            <button type="button" className="ls-x" aria-label="Remove this period" onClick={() => set('partner.giving', gs.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        );
      })}
      {gs.length < 3 ? (
        <button type="button" className="ls-add" onClick={() => quiet('partner.giving', [...gs, { from: '', to: '', min: null, max: null }])}>
          {gs.length ? 'Add another period' : 'Giving in a period'}
        </button>
      ) : null}
    </div>
  );
}

export function Criteria({ menus, spec, counts, set, quiet }: { menus: Menus; spec: ListSpec; counts: Record<SectionId, number>; set: (path: string, v: unknown) => void; quiet: (path: string, v: unknown) => void }) {
  const m = menus || {};
  const holders = (): Opt[] => (m.holders || []).map((h) => [h.id, h.name, h.team ? ((m.teams || []).find((t) => t.id === h.team) || { label: h.team }).label : '']);
  const teams = (): Opt[] => (m.teams || []).map((t) => [t.id, t.label]);
  const funds = (): Opt[] => (m.funds || []).map((f) => [f.id, f.name, f.inactive ? 'Closed fund' : f.category]);
  const appeals = (): Opt[] => (m.appeals || []).map((a) => [a.id, a.code, a.name]);
  return (
    <div className="ls-secs">
      <Section id="status" title="Partner status" n={counts.status} open>
        <Field label="Status">
          <Chips path="partner.status" opts={[['active', 'Active'], ['lybunt', 'LYBUNT'], ['lapsed', 'Lapsed']]} />
        </Field>
        <Field label="Major">
          <Seg path="partner.major" opts={[['any', 'Any'], ['yes', 'Major'], ['no', 'Not major']]} />
        </Field>
        <Field label="Type">
          <Seg path="partner.type" opts={[['any', 'Any'], ['individual', 'Individuals'], ['organization', 'Organizations']]} />
        </Field>
        <Field label="Came in through">
          <Seg path="partner.cameIn" opts={[['any', 'Any'], ['acquisition', 'Acquisition'], ['other', 'Other']]} />
        </Field>
        <Field label="First appeal category">
          <Multi path="partner.firstCats" label="Pick categories" opts={() => plain(m.firstCats)} />
        </Field>
        <Field label="Deceased and inactive">
          <Seg path="partner.deceased" opts={[['exclude', 'Leave out'], ['include', 'Include'], ['only', 'Only']]} />
        </Field>
      </Section>
      <Section id="held" title="Held by" n={counts.held}>
        <Field label="Person">
          <Multi path="partner.holders" label="Pick people" opts={holders} />
        </Field>
        <Field label="Team">
          <Multi path="partner.teams" label="Pick teams" opts={teams} />
        </Field>
        <Field label="Role">
          <Multi path="partner.holderTypes" label="Pick roles" opts={() => plain(m.holderTypes)} />
        </Field>
        <Field label="Holder">
          <Seg path="partner.holder" opts={[['any', 'Any'], ['some', 'Has one'], ['none', 'None']]} />
        </Field>
      </Section>
      <Section id="place" title="Place" n={counts.place}>
        <Field label="State">
          <Multi path="partner.states" label="Pick states" opts={() => plain(m.states)} />
        </Field>
        <Field label="City">
          <TextList path="partner.cities" ph="Tampa, Austin" />
        </Field>
        <Field label="ZIP starts with">
          <TextList path="partner.zips" ph="336, 78701" />
        </Field>
      </Section>
      <Section id="giving" title="Giving" n={counts.giving}>
        <Field label="Lifetime giving">
          <Range path="partner.lifetime" unit="$" />
        </Field>
        <Field label="Largest gift">
          <Range path="partner.largest" unit="$" />
        </Field>
        <Field label="Number of gifts">
          <Range path="partner.gifts" />
        </Field>
        <Giving quiet={quiet} set={set} spec={spec} />
        <Field label="First gift">
          <Span path="partner.firstGift" />
        </Field>
        <Field label="Last gift">
          <Span path="partner.lastGift" />
        </Field>
      </Section>
      <Section id="gifts" title="Gifts" n={counts.gifts}>
        <Field label="Gift date">
          <Span path="gift" />
        </Field>
        <Field label="Gift amount">
          <Range path="gift" unit="$" />
        </Field>
        <Field label="Fund">
          <Multi path="gift.funds" label="Pick funds" opts={funds} />
        </Field>
        <Field label="Fund category">
          <Multi path="gift.fundCats" label="Pick categories" opts={() => plain(m.fundCats)} />
        </Field>
        <Field label="Appeal">
          <Multi path="gift.appeals" label="Pick appeals" opts={appeals} />
        </Field>
        <Field label="Appeal category">
          <Multi path="gift.appealCats" label="Pick categories" opts={() => plain(m.appealCats)} />
        </Field>
        <Field label="Gift type">
          <Chips path="gift.kinds" opts={[['one_time', 'One-time'], ['recurring', 'Recurring']]} />
        </Field>
        <Field label="Paid by">
          <Multi path="gift.methods" label="Pick methods" opts={() => plain(m.methods)} />
        </Field>
        <Field label="Fundraiser credit">
          <Multi path="gift.creditedTo" label="Pick people" opts={holders} />
        </Field>
        <Field label="Soft credit">
          <Seg path="gift.soft" opts={[['any', 'Any'], ['yes', 'Soft credited'], ['no', 'Not soft credited']]} />
        </Field>
      </Section>
      <Section id="records" title="Records" n={counts.records}>
        <Field label="Has solicit code">
          <Multi path="partner.solicitHas" label="Pick codes" opts={() => plain(m.solicit)} />
        </Field>
        <Field label="Lacks solicit code">
          <Multi path="partner.solicitNot" label="Pick codes" opts={() => plain(m.solicit)} />
        </Field>
        <Field label="Constituent code">
          <Multi path="partner.codesHas" label="Pick codes" opts={() => plain(m.codes)} />
        </Field>
        <Field label="Lacks constituent code">
          <Multi path="partner.codesNot" label="Pick codes" opts={() => plain(m.codes)} />
        </Field>
        <Field label="Attribute">
          <Multi path="partner.attrsHas" label="Pick attributes" opts={() => plain(m.attrs)} />
        </Field>
        <Field label="Relationship">
          <Multi path="partner.relsHas" label="Pick relationships" opts={() => plain(m.rels)} />
        </Field>
        <Field label="Event">
          <Multi path="partner.eventsHas" label="Pick events" opts={() => plain(m.events)} />
        </Field>
        <Field label="No contact since">
          <DateIn path="partner.contactBefore" ph="No contact since" />
        </Field>
        <Check path="partner.neverContacted" label="Never contacted" />
        <Check path="partner.mailReady" label="Mail-ready only" />
      </Section>
    </div>
  );
}
