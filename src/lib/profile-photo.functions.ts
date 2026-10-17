import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { decodeProfilePhoto, MAX_PHOTO_BYTES } from "./profile-photo";

const identity = z.object({ playerId: z.string().uuid(), clientKey: z.string().uuid(), roomId: z.string().uuid() });

export const uploadProfilePhoto = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => identity.extend({ photo: z.string().max(Math.ceil(MAX_PHOTO_BYTES / 3) * 4) }).parse(input))
  .handler(async ({ data }) => {
    const bytes = decodeProfilePhoto(data.photo);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: player, error } = await supabaseAdmin.from("players").select("id, avatar_path").eq("id", data.playerId).eq("room_id", data.roomId).eq("client_key", data.clientKey).maybeSingle();
    if (error || !player) throw new Error("Vuelve a entrar en la sala para cambiar tu foto.");
    const path = `${data.roomId}/${player.id}/${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabaseAdmin.storage.from("player-photos").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
    if (uploadError) throw new Error("No se pudo subir la foto. Inténtalo de nuevo.");
    const { error: updateError } = await supabaseAdmin.from("players").update({ avatar_path: path }).eq("id", player.id).eq("client_key", data.clientKey);
    if (updateError) {
      await supabaseAdmin.storage.from("player-photos").remove([path]);
      throw new Error("No se pudo guardar la foto. Inténtalo de nuevo.");
    }
    if (player.avatar_path?.startsWith(`${data.roomId}/${player.id}/`)) await supabaseAdmin.storage.from("player-photos").remove([player.avatar_path]);
    return { path };
  });

export const getRoomProfilePhotos = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => identity.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: member, error } = await supabaseAdmin.from("players").select("id").eq("id", data.playerId).eq("room_id", data.roomId).eq("client_key", data.clientKey).maybeSingle();
    if (error || !member) throw new Error("No se pudieron cargar las fotos.");
    const { data: players } = await supabaseAdmin.from("players").select("id, avatar_path").eq("room_id", data.roomId);
    const photos: Record<string, string> = {};
    await Promise.all((players ?? []).map(async (player) => {
      if (!player.avatar_path?.startsWith(`${data.roomId}/${player.id}/`)) return;
      const { data: signed } = await supabaseAdmin.storage.from("player-photos").createSignedUrl(player.avatar_path, 3600);
      if (signed) photos[player.id] = signed.signedUrl;
    }));
    return photos;
  });