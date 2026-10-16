import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { clienteServidorDemo } from "../demo/almacen";
import { DEMO } from "../demo/consulta";

function clienteReal(almacen: Awaited<ReturnType<typeof cookies>>) {
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

export async function supabaseServidor() {
  // modo demo: base en memoria con la copia de la obra, sin sesión
  if (DEMO) {
    await connection(); // los datos cambian durante la visita: nada de páginas estáticas
    return clienteServidorDemo() as unknown as ReturnType<typeof clienteReal>;
  }
  return clienteReal(await cookies());
}
