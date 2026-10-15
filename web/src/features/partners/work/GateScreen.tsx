// The plain closed card for a person the Work Center is not open to: the Work Center and the Partners lists show the same words.
import { Ic } from './actions/ui';
import './gate.css';

export function GateScreen({ reason }: { reason?: string }) {
  const before = reason === 'before_release';
  return (
    <div className="h-card wc-gate">
      <div className="wc-batch__icon">
        <Ic n="lock" />
      </div>
      <h2>{before ? 'The Work Center opens for you soon' : 'The Work Center is for the people whose job touches it'}</h2>
      <p>{before ? 'This page is not open for your account yet.' : 'It holds the open actions, thank-yous and partner work of the Support Team, the regional directors, Partner Care and church engagement. If your work needs it, tell Will Hamilton through Feedback.'}</p>
    </div>
  );
}
