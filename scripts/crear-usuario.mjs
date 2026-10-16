// Crea (o actualiza la contraseña de) un usuario de la app. Las altas públicas están desactivadas.
// Uso (clave service_role; en local: `supabase status -o env`): SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/crear-usuario.mjs correo@empresa.com 'contraseña'
const [email, password] = process.argv.slice(2);
const url = (process.env.SUPABASE_URL ?? "http://127.0.0.1:54321").replace(/\/$/, "");
const key = process.env.SUPABASE_SECRET_KEY;
if (!email || !password || !key) {
  console.error("Uso: SUPABASE_SECRET_KEY=… node scripts/crear-usuario.mjs correo contraseña");
  process.exit(1);
}
const h = { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" };
const lista = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers: h }).then((r) => r.json());
const existente = lista.users?.find((u) => u.email === email);
const r = existente
  ? await fetch(`${url}/auth/v1/admin/users/${existente.id}`, { method: "PUT", headers: h, body: JSON.stringify({ password }) })
  : await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: h, body: JSON.stringify({ email, password, email_confirm: true }) });
if (!r.ok) {
  console.error(r.status, await r.text());
  process.exit(1);
}
console.log(existente ? "Contraseña actualizada" : "Usuario creado", email);
