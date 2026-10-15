// A word with its plain meaning on hover, focus and tap (the hub's [data-term] tooltip reads these attributes). Same words as favor-ui.js.
const TERMS: Record<string, { label: string; tip: string }> = {
  lifetime: { label: 'Lifetime giving', tip: 'Every gift credited to this partner and their spouse: their own gifts plus gifts sent through a donor-advised fund, foundation or business that name them. A gift counts once, for the partner it names.' },
  soft: { label: 'Soft credit', tip: 'Someone else’s record sent the money, usually a donor-advised fund, foundation or business, and named this partner as the giver. FavorOS counts the gift for the partner it names, not for the record that sent it.' },
  other: { label: 'Other', tip: 'Blackbaud recorded the payment type as Other. Most are donor-advised fund grants, wires and online gifts Blackbaud has no closer name for.' },
};

export function Term({ k, label }: { k: keyof typeof TERMS; label?: string }) {
  const t = TERMS[k];
  const text = label || t.label;
  return (
    <span className="h-term" tabIndex={0} role="button" aria-label={text + '. ' + t.tip} data-term={t.tip}>
      {text}
    </span>
  );
}
