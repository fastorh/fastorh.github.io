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

  const { email, nombre, apellido, texto, estrellas } = body || {};
  const normalizedEmail = (email || '').toString().trim().toLowerCase();

  if (!normalizedEmail.endsWith('@gmail.com')) {
    return new Response(JSON.stringify({ error: 'Email debe ser @gmail.com' }), { status: 400, headers: corsHeaders });
  }
  if (!nombre || nombre.toString().trim().length < 2) {
    return new Response(JSON.stringify({ error: 'Nombre inválido' }), { status: 400, headers: corsHeaders });
  }
  if (!apellido || apellido.toString().trim().length < 2) {
    return new Response(JSON.stringify({ error: 'Apellido inválido' }), { status: 400, headers: corsHeaders });
  }
  const textoTrimmed = (texto || '').toString().trim();
  if (textoTrimmed.length < 20 || textoTrimmed.length > 500) {
    return new Response(JSON.stringify({ error: 'Reseña debe tener entre 20 y 500 caracteres' }), { status: 400, headers: corsHeaders });
  }
  const estrellasNum = Number(estrellas);
  if (!estrellasNum || estrellasNum < 1 || estrellasNum > 5) {
    return new Response(JSON.stringify({ error: 'Valoración inválida' }), { status: 400, headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || 'IndexFreedom <noreply@indexfreedom.xyz>';

  if (!RESEND_API_KEY) {
    console.error('Missing env var: RESEND_API_KEY');
    return new Response(JSON.stringify({ error: 'Error de configuración del servidor' }), { status: 500, headers: corsHeaders });
  }

  // Rate limit: máx. 3 códigos por email en los últimos 10 minutos
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  try {
    const rlRes = await fetch(
      `${SUPABASE_URL}/rest/v1/verification_codes?select=id&email=eq.${encodeURIComponent(normalizedEmail)}&created_at=gte.${encodeURIComponent(tenMinAgo)}`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    if (rlRes.ok) {
      const existing = await rlRes.json();
      if (Array.isArray(existing) && existing.length >= 3) {
        return new Response(
          JSON.stringify({ error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }),
          { status: 429, headers: corsHeaders }
        );
      }
    }
  } catch (_) { /* continuar aunque el rate-limit falle */ }

  // Generar código de 6 dígitos
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const nombreStr = nombre.toString().trim();

  // Guardar en Supabase
  const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/verification_codes`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      email: normalizedEmail,
      code,
      nombre: nombreStr,
      apellido: apellido.toString().trim(),
      texto: textoTrimmed,
      estrellas: estrellasNum,
      used: false,
      expires_at: expiresAt,
    }),
  });

  if (!dbRes.ok) {
    console.error('Supabase DB error:', await dbRes.text());
    return new Response(JSON.stringify({ error: 'Error al guardar el código' }), { status: 500, headers: corsHeaders });
  }

  const emailHtml = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:500px;margin:40px auto;background:#1a1d27;border-radius:14px;overflow:hidden;border:1px solid #2d3148">
    <div style="background:linear-gradient(135deg,#00d46a 0%,#00b857 100%);padding:28px 32px">
      <h1 style="color:#fff;margin:0;font-size:24px;font-weight:800;letter-spacing:-0.5px">IndexFreedom</h1>
      <p style="color:rgba(255,255,255,0.8);margin:6px 0 0;font-size:13px">Inversión inteligente para todos</p>
    </div>
    <div style="padding:36px 32px">
      <h2 style="color:#f1f5f9;font-size:20px;margin:0 0 14px;font-weight:700">Verifica tu reseña</h2>
      <p style="color:#94a3b8;font-size:14px;line-height:1.75;margin:0 0 30px">
        Hola <strong style="color:#f1f5f9">${nombreStr}</strong>, hemos recibido tu reseña en IndexFreedom.<br>
        Introduce el siguiente código en la web para confirmar tu email y publicarla:
      </p>
      <div style="background:#0f1117;border:2px solid #00d46a;border-radius:12px;padding:24px 20px;text-align:center;margin-bottom:30px">
        <p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 10px;font-weight:600">Tu código de verificación</p>
        <div style="font-size:46px;font-weight:900;letter-spacing:16px;color:#00d46a;font-family:'Courier New',monospace;line-height:1">${code}</div>
      </div>
      <div style="background:#1e2235;border-radius:8px;padding:14px 16px">
        <p style="color:#64748b;font-size:12px;line-height:1.7;margin:0">
          ⏱ Este código expira en <strong style="color:#94a3b8">10 minutos</strong>.<br>
          🔒 Si no enviaste esta reseña, puedes ignorar este email con total tranquilidad.
        </p>
      </div>
    </div>
    <div style="padding:16px 32px;background:#0f1117;border-top:1px solid #2d3148;text-align:center">
      <p style="color:#334155;font-size:11px;margin:0">© 2025 IndexFreedom · Tu email no se mostrará públicamente</p>
    </div>
  </div>
</body>
</html>`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [normalizedEmail],
      subject: `${code} es tu código de verificación de IndexFreedom`,
      html: emailHtml,
    }),
  });

  if (!emailRes.ok) {
    console.error('Resend error:', await emailRes.text());
    return new Response(
      JSON.stringify({ error: 'Error al enviar el email. Comprueba que el correo es correcto.' }),
      { status: 500, headers: corsHeaders }
    );
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
});
