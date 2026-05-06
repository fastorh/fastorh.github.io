const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: corsHeaders });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: corsHeaders });
  }

  const { email, code } = body || {};
  const normalizedEmail = (email || '').toString().trim().toLowerCase();
  const normalizedCode = (code || '').toString().trim();

  if (!normalizedEmail || !normalizedCode || normalizedCode.length !== 6) {
    return new Response(JSON.stringify({ error: 'Email o código inválido' }), { status: 400, headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const now = new Date().toISOString();

  // Buscar código válido (no usado, no expirado)
  const queryRes = await fetch(
    `${SUPABASE_URL}/rest/v1/verification_codes?select=id,nombre,apellido,texto,estrellas` +
    `&email=eq.${encodeURIComponent(normalizedEmail)}` +
    `&code=eq.${encodeURIComponent(normalizedCode)}` +
    `&used=eq.false` +
    `&expires_at=gt.${encodeURIComponent(now)}` +
    `&order=created_at.desc&limit=1`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    }
  );

  if (!queryRes.ok) {
    console.error('Supabase query error:', await queryRes.text());
    return new Response(JSON.stringify({ error: 'Error al validar el código' }), { status: 500, headers: corsHeaders });
  }

  const rows = await queryRes.json();
  if (!rows || rows.length === 0) {
    return new Response(
      JSON.stringify({ error: 'Código incorrecto o expirado. Compruébalo e inténtalo de nuevo.' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const row = rows[0];

  // Marcar código como usado
  const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/verification_codes?id=eq.${row.id}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ used: true }),
  });

  if (!updateRes.ok) {
    console.error('Update error:', await updateRes.text());
    return new Response(JSON.stringify({ error: 'Error al procesar el código' }), { status: 500, headers: corsHeaders });
  }

  // Insertar la reseña
  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/reviews`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      email: normalizedEmail,
      nombre: row.nombre,
      apellido: row.apellido,
      texto: row.texto,
      estrellas: row.estrellas,
      visible: true,
    }),
  });

  if (!insRes.ok) {
    console.error('Insert review error:', await insRes.text());
    return new Response(JSON.stringify({ error: 'Error al publicar la reseña' }), { status: 500, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
});
