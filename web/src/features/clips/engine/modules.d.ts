// The clips engine files live in public/js/clips (the classic pages load them by URL) and are bundled here through the @clips alias in
// vite.config.ts. They are plain JavaScript, so every import from them is typed any and the callers narrow what they use.
declare module '@clips/*';
