import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set([
  'https://tryskindecode.online',
  'http://localhost:3000',
]);

function responseHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    ...(origin && allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  };
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  const headers = responseHeaders(origin);
  if (origin && !allowedOrigins.has(origin)) {
    return Response.json({ error: 'Request origin is not allowed.' }, { status: 403, headers });
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers });

  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return Response.json({ error: 'Sign in to delete your account.' }, { status: 401, headers });
  }

  let confirmation: unknown;
  try {
    confirmation = (await request.json() as { confirm?: unknown }).confirm;
  } catch {
    return Response.json({ error: 'Confirm account deletion to continue.' }, { status: 400, headers });
  }
  if (confirmation !== true) {
    return Response.json({ error: 'Confirm account deletion to continue.' }, { status: 400, headers });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRoleKey) {
    return Response.json({ error: 'Account deletion is temporarily unavailable.' }, { status: 503, headers });
  }

  const token = authorization.slice('Bearer '.length);
  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) {
    return Response.json({ error: 'Your session expired. Sign in again and retry.' }, { status: 401, headers });
  }

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error('[delete-account] Auth user deletion failed.');
    return Response.json({ error: 'We could not delete your account. Please try again.' }, { status: 500, headers });
  }
  return Response.json({ success: true }, { status: 200, headers });
});
