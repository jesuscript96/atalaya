"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Ajustes } from "@/lib/tipos";

const texto = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v || null;
};

export async function crearObra(form: FormData) {
  const sb = await supabaseServidor();
  const { data, error } = await sb
    .from("obras")
    .insert({ nombre: texto(form, "nombre") ?? "Obra sin nombre", direccion: texto(form, "direccion"), cliente: texto(form, "cliente"),
              fecha_inicio: texto(form, "fecha_inicio"), fecha_fin: texto(form, "fecha_fin") })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  redirect(`/obras/${data.id}/documentos`);
}

export async function actualizarObra(id: string, form: FormData) {
  const sb = await supabaseServidor();
  const { error } = await sb.from("obras").update({
    nombre: texto(form, "nombre") ?? "Obra sin nombre", direccion: texto(form, "direccion"), cliente: texto(form, "cliente"),
    fecha_inicio: texto(form, "fecha_inicio"), fecha_fin: texto(form, "fecha_fin"),
  }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/obras/${id}`, "layout");
}

export async function guardarAjustes(id: string, ajustes: Ajustes) {
  const sb = await supabaseServidor();
  const { error } = await sb.from("obras").update({ ajustes }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/obras/${id}`, "layout");
}

export async function borrarObra(id: string) {
  const sb = await supabaseServidor();
  // archivos de la obra: documentos/… y hojas/<documento>/… (el listado del almacenamiento no es recursivo)
  const lista = async (ruta: string) => (await sb.storage.from("obras").list(ruta, { limit: 1000 })).data ?? [];
  const rutas = (await lista(`${id}/documentos`)).map((d) => `${id}/documentos/${d.name}`);
  rutas.push(...(await lista(`${id}/fotos`)).map((f) => `${id}/fotos/${f.name}`));
  for (const carpeta of await lista(`${id}/hojas`)) {
    rutas.push(...(await lista(`${id}/hojas/${carpeta.name}`)).map((f) => `${id}/hojas/${carpeta.name}/${f.name}`));
  }
  for (let i = 0; i < rutas.length; i += 100) await sb.storage.from("obras").remove(rutas.slice(i, i + 100));
  const { error } = await sb.from("obras").delete().eq("id", id);
  if (error) throw new Error(error.message);
  redirect("/");
}
