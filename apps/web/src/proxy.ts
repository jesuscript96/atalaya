import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEMO } from "./lib/demo/consulta";
import { COOKIE_VERSION, PERSISTE, situacion } from "./lib/demo/registro";

// Refresca la sesión de Supabase y manda al acceso a quien no la tenga.
export async function proxy(request: NextRequest) {
  // demo pública: sin acceso
  if (DEMO) {
    if (!request.nextUrl.pathname.startsWith("/login")) {
      // visitante nuevo: se le da la versión actual de los cambios guardados, para que vea lo último
      if (!PERSISTE || request.cookies.has(COOKIE_VERSION)) return NextResponse.next();
      const v = String((await situacion().catch(() => ({ ultima: 0 }))).ultima);
      request.cookies.set(COOKIE_VERSION, v);
      const r = NextResponse.next({ request });
      r.cookies.set(COOKIE_VERSION, v, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 12 });
      return r;
    }
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  let respuesta = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (lista, cabeceras) => {
        lista.forEach(({ name, value }) => request.cookies.set(name, value));
        respuesta = NextResponse.next({ request });
        lista.forEach(({ name, value, options }) => respuesta.cookies.set(name, value, options));
        Object.entries(cabeceras ?? {}).forEach(([k, v]) => respuesta.headers.set(k, v));
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const enAcceso = request.nextUrl.pathname.startsWith("/login");
  if (!data?.claims && !enAcceso) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (data?.claims && enAcceso) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return respuesta;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
