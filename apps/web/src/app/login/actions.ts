"use server";
import { redirect } from "next/navigation";
import { supabaseServidor } from "@/lib/supabase/server";

export async function entrar(form: FormData) {
  const sb = await supabaseServidor();
  const { error } = await sb.auth.signInWithPassword({
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
  });
  if (error) redirect("/login?error=1");
  redirect("/");
}

export async function salir() {
  const sb = await supabaseServidor();
  await sb.auth.signOut();
  redirect("/login");
}
