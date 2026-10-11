import { BUILD } from '../data/build';

export const prerender = true;
export const GET = () => new Response(JSON.stringify({ build: BUILD }), { headers: { 'Content-Type': 'application/json' } });
