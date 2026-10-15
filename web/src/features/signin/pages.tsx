// The sign-in and Connect Google pages. Ports of src/pages/login.astro and src/pages/connect/index.astro: the same markup and words, the same stylesheet
// (src/styles/signin.css, inlined) and the same scripts (public/js/login.js, and the few lines that name why Google was not connected).
// The Worker answers these two addresses straight from server.ts as plain HTML with no router and no hydration, so a script that changes
// a part of the page never meets a framework that owns it, and the page weighs what the classic one did.
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import css from '@hub/styles/signin.css?inline';

/** The photo half and the card around the words, shared by both pages. */
export function SigninFrame({ children }: { children: ReactNode }) {
  return (
    <main className="si-shell">
      <section className="si-photo" aria-hidden="true">
        <img src="/images/signin-field.jpg" alt="" />
        <div className="si-photo__words">
          <img className="si-photo__logo" src="/images/favor-logo-white.png" alt="" />
          <p>Transformed hearts transform nations.</p>
        </div>
      </section>
      <section className="si-panel">
        <div className="si-card">
          <img className="si-logo" src="/images/favor-logo-color.png" alt="Favor International" />
          {children}
        </div>
      </section>
    </main>
  );
}

export function LoginPage() {
  return (
    <>
      <SigninFrame>
        <p className="si-kicker" style={{ textTransform: 'none' }}>
          FavorOS
        </p>
        <h1>Sign in</h1>
        <p className="si-lede">
          Use your Favor Google account, the one that ends in @favorintl.org. Field staff sign in with the Google account Favor gave them. A new person waits for an admin to approve them.
        </p>
        <div className="si-google" id="si-google" aria-live="polite" dangerouslySetInnerHTML={{ __html: '<span class="si-wait">Loading Google sign-in...</span>' }} />
        <p className="si-msg" id="si-msg" role="alert" hidden />
        <p className="si-help">
          Requests, expenses, receipts, foundation prospects and reports all open from here. Can't get in? Email <a href="mailto:tech@favorintl.org">tech@favorintl.org</a>.
        </p>
      </SigninFrame>
      <script src="/js/login.js?v=2" />
    </>
  );
}

// The words under the button when Google came back with a reason (the address carries ?google=<reason>).
const WHY = `const n = new URLSearchParams(location.search).get('google');
const m = { declined: 'Google was not connected. Press Connect my Google and choose Allow.', 'wrong-account': 'Pick your Favor account when Google asks.', expired: 'That took too long. Try again.', failed: 'Google did not connect. Try again.', 'no-token': 'Google did not hand back access. Try again.' };
if (m[n]) document.getElementById('c-msg').textContent = m[n];`;

export function ConnectPage() {
  return (
    <>
      <SigninFrame>
        <h1>One more step</h1>
        <p className="si-lede" id="c-msg">
          FavorOS needs your Favor Google calendar, Drive and inbox to show what is on your day.
        </p>
        <p className="si-lede">It reads event times and titles, file names, and who emailed you. It never opens an email or a file.</p>
        <a className="si-btn" href="/api/google/connect" style={{ display: 'inline-block', marginTop: 14, padding: '12px 20px', borderRadius: 10, background: '#2b4d24', color: '#fff', fontWeight: 700, textDecoration: 'none' }}>
          Connect my Google
        </a>
        <p className="si-fine" style={{ marginTop: 18 }}>
          Questions? Email <a href="mailto:tech@favorintl.org">tech@favorintl.org</a>.
        </p>
      </SigninFrame>
      <script dangerouslySetInnerHTML={{ __html: WHY }} />
    </>
  );
}

function Document({ title, full, children }: { title: string; full?: boolean; children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content={full ? 'width=device-width, initial-scale=1.0, viewport-fit=cover' : 'width=device-width, initial-scale=1.0'} />
        <meta name="robots" content="noindex" />
        <link rel="icon" type="image/png" href="/images/favor-icon.png" />
        {full ? (
          <>
            <link rel="apple-touch-icon" href="/images/apple-touch-icon.png" />
            <link rel="manifest" href="/manifest.webmanifest?v=favoros" />
            <meta name="apple-mobile-web-app-capable" content="yes" />
            <meta name="mobile-web-app-capable" content="yes" />
            <meta name="apple-mobile-web-app-title" content="FavorOS" />
            <meta name="apple-mobile-web-app-status-bar-style" content="default" />
            <link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossOrigin="" />
            <link rel="preload" href="/fonts/playfair-500.woff2" as="font" type="font/woff2" crossOrigin="" />
            <meta name="theme-color" content="#f4efe0" />
          </>
        ) : null}
        <title>{title}</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body className="si">{children}</body>
    </html>
  );
}

/** The page for an address the Worker answers on its own (/login/ and /connect/), or null for any other. */
export function signinHtml(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, '');
  if (p === '/login') {
    return '<!doctype html>' + renderToStaticMarkup(<Document title="Sign in - FavorOS" full><LoginPage /></Document>);
  }
  if (p === '/connect') {
    return '<!doctype html>' + renderToStaticMarkup(<Document title="Connect Google - FavorOS"><ConnectPage /></Document>);
  }
  return null;
}
