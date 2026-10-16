import type { NextConfig } from "next";

// App interna que depende de la sesión del usuario: renderizado dinámico clásico, sin Cache Components.
const nextConfig: NextConfig = {
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
