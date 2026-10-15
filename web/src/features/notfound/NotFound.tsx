// A web address with nothing behind it (/help/old-article/): the same card the classic 404 page draws (src/pages/404.astro), inside the frame.
export function NotFound() {
  return (
    <div className="h-card h-note">
      <h2 style={{ fontSize: 18, fontWeight: 800 }}>That page isn't here</h2>
      <p className="h-lede" style={{ margin: '6px 0 14px' }}>
        The link may be old. Every tool is in the menu, and Search finds any of them.
      </p>
      <a className="h-btn h-btn--primary h-btn--sm" href="/">
        Go to Today
      </a>
    </div>
  );
}
