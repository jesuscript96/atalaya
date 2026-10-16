import { createBrowserClient } from "@supabase/ssr";
import { demoConsulta, demoFirmar, demoQuitar, demoSubir } from "../demo/acciones";
import { DEMO, clienteDemo } from "../demo/consulta";

const clienteReal = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
type Cliente = ReturnType<typeof clienteReal>;

const aDataUrl = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(b);
});

export function supabaseNavegador(): Cliente {
  // modo demo: las consultas van a la base en memoria del servidor
  if (DEMO) {
    return clienteDemo(demoConsulta, {
      firmar: demoFirmar,
      subir: async (ruta, archivo) => demoSubir(ruta, await aDataUrl(archivo)),
      quitar: demoQuitar,
    }) as unknown as Cliente;
  }
  return clienteReal();
}
