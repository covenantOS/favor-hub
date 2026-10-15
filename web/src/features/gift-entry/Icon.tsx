// The small icons gift-entry.js drew inline (check, plus, camera, image, back, send), the same paths.
const PATHS: Record<string, string> = {
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  send: '<path d="M4 12 20 4l-4 16-4-6z"/>',
};

export function Icon({ n }: { n: keyof typeof PATHS }) {
  return <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PATHS[n] }} />;
}
