const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://indexfreedom.xyz',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders })
  }

  try {
    const { nombre, primer_apellido, email, valoracion, texto } = await req.json()

    if (!nombre || !primer_apellido || !email || !valoracion || !texto) {
      return new Response(JSON.stringify({ error: 'Todos los campos son obligatorios' }), { status: 400, headers: corsHeaders })
    }

    const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SVC_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const BREVO_API_KEY     = Deno.env.get('BREVO_API_KEY')!

    // Insertar reseña con verified=false
    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/reviews`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SVC_KEY,
        Authorization: `Bearer ${SUPABASE_SVC_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ nombre, primer_apellido, email, valoracion: Number(valoracion), texto, verified: false }),
    })

    if (!insRes.ok) {
      console.error('Insert review error:', await insRes.text())
      return new Response(JSON.stringify({ error: 'Error al guardar la reseña' }), { status: 500, headers: corsHeaders })
    }

    const reviewData = await insRes.json()
    const reviewId = reviewData[0]?.id

    // Generar código de 6 dígitos
    const code      = String(Math.floor(100000 + Math.random() * 900000))
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    // Guardar código de verificación
    const codeRes = await fetch(`${SUPABASE_URL}/rest/v1/verification_codes`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SVC_KEY,
        Authorization: `Bearer ${SUPABASE_SVC_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ review_id: reviewId, email, code, expires_at: expiresAt, used: false }),
    })

    if (!codeRes.ok) {
      console.error('Insert code error:', await codeRes.text())
      return new Response(JSON.stringify({ error: 'Error al generar el código' }), { status: 500, headers: corsHeaders })
    }

    // Enviar email con código via Brevo
    const emailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'IndexFreedom', email: 'noreply@indexfreedom.xyz' },
        to: [{ email }],
        subject: `${code} es tu código de verificación — IndexFreedom`,
        htmlContent: `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:0;background:#0f1117;font-family:Arial,sans-serif">
  <div style="max-width:500px;margin:40px auto;background:#1a1d27;border-radius:14px;border:1px solid #2d3148">
    <div style="background:linear-gradient(135deg,#00d46a,#00b857);padding:28px 32px;border-radius:14px 14px 0 0">
      <h1 style="color:#fff;margin:0;font-size:24px;font-weight:800">IndexFreedom</h1>
    </div>
    <div style="padding:36px 32px">
      <h2 style="color:#f1f5f9;margin:0 0 14px">Verifica tu reseña</h2>
      <p style="color:#94a3b8;font-size:14px;line-height:1.75;margin:0 0 30px">
        Hola <strong style="color:#f1f5f9">${nombre}</strong>, introduce este código en la web para publicar tu reseña:
      </p>
      <div style="background:#0f1117;border:2px solid #00d46a;border-radius:12px;padding:24px;text-align:center;margin-bottom:30px">
        <p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:2px;margin:0 0 10px">Tu código de verificación</p>
        <div style="font-size:48px;font-weight:900;letter-spacing:16px;color:#00d46a;font-family:'Courier New',monospace">${code}</div>
      </div>
      <p style="color:#64748b;font-size:12px">⏱ Expira en 10 minutos · 🔒 Si no fuiste tú, ignora este email</p>
    </div>
  </div>
</body></html>`,
      }),
    })

    if (!emailRes.ok) {
      console.error('Brevo error:', await emailRes.text())
      return new Response(JSON.stringify({ error: 'Error al enviar el email' }), { status: 500, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ success: true, reviewId, message: 'Código enviado al email' }), { status: 200, headers: corsHeaders })

  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Error interno del servidor' }), { status: 500, headers: corsHeaders })
  }
})
