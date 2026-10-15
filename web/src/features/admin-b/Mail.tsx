// Text that holds an email address. Cloudflare rewrites an address in the server's HTML into a [email protected] link, and the page then
// disagrees with what React draws (error 418). The server writes the address with a full-width @ instead, which the rewrite leaves alone,
// and the browser puts the real @ back as soon as the page is live.
import { useSyncExternalStore } from 'react';

const none = () => () => {};
const mounted = () => true;
const server = () => false;
const useMounted = () => useSyncExternalStore(none, mounted, server);

/** The text with every email address hidden from the rewrite until the page is live. */
export const hideMail = (s: string) => s.replace(/@/g, '＠');

export function Mail({ text }: { text: string }) {
  const live = useMounted();
  return <>{live ? text : hideMail(text)}</>;
}
