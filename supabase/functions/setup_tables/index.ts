import postgres from "https://deno.land/x/postgresjs/mod.js"

Deno.serve(async () => {
  const DB_URL = Deno.env.get('SUPABASE_DB_URL')!
  const sql = postgres(DB_URL, { prepare: false })

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS public.verification_codes (
        id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
        review_id  uuid        REFERENCES public.reviews(id) ON DELETE CASCADE,
        email      text        NOT NULL,
        code       text        NOT NULL,
        used       boolean     NOT NULL DEFAULT false,
        expires_at timestamptz NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `
    await sql`ALTER TABLE public.verification_codes ENABLE ROW LEVEL SECURITY`
    await sql.end()

    console.log('Tabla verification_codes creada OK')
    return new Response(
      JSON.stringify({ ok: true, message: 'Tabla verification_codes creada correctamente' }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    )
  } catch (err) {
    console.error('Error:', err)
    await sql.end()
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    )
  }
})
