import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function supabaseServidor() {
  const almacen = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => almacen.getAll(),
      setAll: (lista) => {
        try {
          lista.forEach(({ name, value, options }) => almacen.set(name, value, options));
        } catch {
          // en componentes de servidor no se pueden escribir cookies; el proxy ya refresca la sesión
        }
      },
    },
  });
}
