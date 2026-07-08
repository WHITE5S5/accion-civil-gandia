// Verificación de sesión de usuario (Fase 3): valida el JWT del ciudadano
// contra Supabase Auth y devuelve el usuario, o null.
export async function getUser(req) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token || !process.env.SUPABASE_URL) return null;
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${token}`,
      },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  } catch { return null; }
}
