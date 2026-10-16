import type { NextConfig } from "next";

// App interna que depende de la sesión del usuario: renderizado dinámico clásico, sin Cache Components.
const nextConfig: NextConfig = {
  // modo demo: la copia de la obra se lee del disco y las fotos llegan a las acciones como data URL
  outputFileTracingIncludes: { "/**": ["./demo-privado/**"] },
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
