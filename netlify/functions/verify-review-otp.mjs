export default async (req) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers });
  }

  const { email, code } = body || {};
  const normalizedEmail = (email || '').toString().trim().toLowerCase();
  const normalizedCode  = (code || '').toString().trim();

  if (!normalizedEmail || !normalizedCode || normalizedCode.length !== 6) {
    return new Response(JSON.stringify({ error: 'Email o código inválido' }), { status: 400, headers });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing env vars: SUPABASE_URL o SUPABASE_SERVICE_KEY');
    return new Response(JSON.stringify({ error: 'Error de configuración del servidor' }), { status: 500, headers });
  }

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
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    }
  );

  if (!queryRes.ok) {
    console.error('Supabase query error:', await queryRes.text());
    return new Response(JSON.stringify({ error: 'Error al validar el código' }), { status: 500, headers });
  }

  const rows = await queryRes.json();
  if (!rows || rows.length === 0) {
    return new Response(
      JSON.stringify({ error: 'Código incorrecto o expirado. Compruébalo e inténtalo de nuevo.' }),
      { status: 400, headers }
    );
  }

  const row = rows[0];

  // Marcar código como usado (evita reutilización)
  const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/verification_codes?id=eq.${row.id}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ used: true })
  });

  if (!updateRes.ok) {
    console.error('Update error:', await updateRes.text());
    return new Response(JSON.stringify({ error: 'Error al procesar el código' }), { status: 500, headers });
  }

  // Insertar la reseña en Supabase
  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/reviews`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({
      email: normalizedEmail,
      nombre: row.nombre,
      apellido: row.apellido,
      texto: row.texto,
      estrellas: row.estrellas,
      visible: true
    })
  });

  if (!insRes.ok) {
    console.error('Insert review error:', await insRes.text());
    return new Response(JSON.stringify({ error: 'Error al publicar la reseña' }), { status: 500, headers });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};
