export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export function decodeProfilePhoto(encoded: string): Uint8Array {
  if (!encoded || encoded.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4) throw new Error("La foto es demasiado grande.");
  let raw: string;
  try { raw = atob(encoded); } catch { throw new Error("La foto no es válida."); }
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  if (bytes.length > MAX_PHOTO_BYTES || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) {
    throw new Error("La foto no es válida.");
  }
  return bytes;
}

export async function prepareProfilePhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Selecciona una imagen.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Selecciona una foto más pequeña.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 384;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo preparar la foto.");
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 384, 384);
    return canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "";
  } finally { bitmap.close(); }
}