import type { Metadata } from "next";
import { Marca } from "@/components/Marca";
import { entrar } from "./actions";

export const metadata: Metadata = { title: "Acceso" };

export default async function Login({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <main className="flex-1 grid place-items-center p-4" style={{ background: "var(--rail)" }}>
      <form action={entrar} className="card card-pad w-full max-w-sm flex flex-col gap-4">
        <div>
          <h1><Marca /></h1>
          <p className="muted mt-1 text-sm">Control de obra sobre plano</p>
        </div>
        <label className="campo">
          Correo
          <input className="input" name="email" type="email" autoComplete="username" required />
        </label>
        <label className="campo">
          Contraseña
          <input className="input" name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <p className="chip chip-late self-start">Correo o contraseña incorrectos</p>}
        <button className="btn btn-primary">Entrar</button>
      </form>
    </main>
  );
}
