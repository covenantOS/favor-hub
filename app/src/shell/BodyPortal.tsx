// A portal into document.body that mounts after the first render, so a page drawn on the server and hydrated in the browser agree.
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

function Portal({ node }: { node: ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(true), []);
  return on ? createPortal(node, document.body) : null;
}

export const BodyPortal = (node: ReactNode) => <Portal node={node} />;
