/** Reduce una foto en el navegador antes de subirla (las de móvil pesan 5–12 MB). */
export async function redimensionar(file: File, maxLado: number, calidad = 0.85): Promise<{ blob: Blob; ancho: number; alto: number }> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
  const ancho = Math.round(bmp.width * escala), alto = Math.round(bmp.height * escala);
  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");
  ctx.drawImage(bmp, 0, 0, ancho, alto);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", calidad));
  if (!blob) throw new Error("No se pudo convertir la imagen");
  return { blob, ancho, alto };
}
