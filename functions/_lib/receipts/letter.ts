// The words of the thank-you letter and the gift amounts offered on the reply slip.
//
// The text is the letter in use since March 2025, taken from the last archived
// batch (2025-10-03). The three InDesign templates had drifted apart: one read
// "Uganda,Chad", bold fell on different sentences, and one had no comma after
// the greeting. This is the one copy all three now share.
//
// Marks: **bold**, {amount} for the gift amount.

export interface LetterCopy {
  paragraphs: string[];
  closing: string;
  signerName: string;
  signerTitle: string;
  /** 'full' prints "Dear Linda Hertzman,". 'first' prints "Dear Linda,". */
  greeting: 'full' | 'first';
  asks: { regular: number[]; major: number[] };
}

export const DEFAULT_COPY: LetterCopy = {
  paragraphs: [
    '**Thank you so much for your generous gift of {amount}!** Your kindness makes an impact in the lives of people across Africa.',
    'Our missionaries travel to remote areas in South Sudan, Uganda, Chad, and seven other nations to share the Gospel through our Portable Bible Schools (PBSs). Over the course of 3-4 months, students receive biblical teachings, discipleship, trauma counseling, their own Bibles, and so much more!',
    '**Through our GIFT children’s home (GIFT), we’re able to rescue hundreds of street children from homelessness and hunger.** Your support provides these vulnerable kids with a place of belonging. They receive education, meals, a place to sleep, and the love of Jesus.',
    'We can’t thank you enough for your compassion for God’s people. We love and pray for you every day.',
  ],
  closing: 'With Joy,',
  signerName: 'Carole Ward',
  signerTitle: 'Founder',
  greeting: 'full',
  asks: { regular: [25, 50, 100, 250], major: [200, 250, 500, 1000] },
};

/** Keep a saved copy only where it is well formed; anything else falls back to the default. */
export function cleanCopy(value: unknown): LetterCopy {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<LetterCopy>;
  const text = (s: unknown, max: number): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const paragraphs = Array.isArray(v.paragraphs) ? v.paragraphs.map((p) => text(p, 900)).filter(Boolean).slice(0, 6) : [];
  const amounts = (list: unknown, fallback: number[]): number[] => {
    const out = Array.isArray(list) ? list.map(Number).filter((n) => Number.isFinite(n) && n > 0 && n < 1000000).slice(0, 4) : [];
    return out.length === 4 ? out : fallback;
  };
  return {
    paragraphs: paragraphs.length > 0 ? paragraphs : DEFAULT_COPY.paragraphs,
    closing: text(v.closing, 60) || DEFAULT_COPY.closing,
    signerName: text(v.signerName, 60) || DEFAULT_COPY.signerName,
    signerTitle: text(v.signerTitle, 60) || DEFAULT_COPY.signerTitle,
    greeting: v.greeting === 'first' ? 'first' : 'full',
    asks: {
      regular: amounts(v.asks?.regular, DEFAULT_COPY.asks.regular),
      major: amounts(v.asks?.major, DEFAULT_COPY.asks.major),
    },
  };
}
