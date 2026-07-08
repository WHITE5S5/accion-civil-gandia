import { cacheHeaders, getEquipo } from './lib/content-api.mjs';

export default async (req) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: { code: 'method_not_allowed', message: 'Solo GET' } }), {
      status: 405,
      headers: cacheHeaders(0),
    });
  }
  const data = await getEquipo(Object.fromEntries(new URL(req.url).searchParams.entries()));
  return new Response(JSON.stringify(data), { status: 200, headers: cacheHeaders() });
};

export const config = { path: '/api/equipo' };
