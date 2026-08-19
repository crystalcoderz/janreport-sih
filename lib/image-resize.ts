// Downscale a camera photo in the browser before it is uploaded.
//
// A modern phone camera produces 4-12 MP JPEGs of 3-8 MB. Nothing downstream
// benefits: the AI classifier sees a resized copy anyway, the officer views it
// in a card, and Supabase's free storage tier is 1 GB — roughly 285 reports at
// 3.5 MB, versus several thousand at this size. WhatsApp already recompresses
// on the sender's handset (its photos arrive around 110 KB), so this only
// closes the gap for web uploads, which were the one uncapped path.

const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.82;
// Below this there is nothing worth re-encoding, and re-encoding a small
// image can easily make it bigger.
const SKIP_BELOW_BYTES = 400 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode image"));
    };
    img.src = url;
  });
}

// Always resolves: a failure here must never block a citizen from reporting,
// so anything unexpected returns the original file and the 8 MB server-side
// cap still applies.
export async function downscaleImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= SKIP_BELOW_BYTES) return file;

  try {
    const img = await loadImage(file);
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    if (longest <= MAX_EDGE_PX && file.size <= SKIP_BELOW_BYTES) return file;

    const scale = Math.min(1, MAX_EDGE_PX / longest);
    const width = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob || blob.size >= file.size) return file;

    // Renamed to .jpg because the bytes are now JPEG regardless of what came
    // in — the server sniffs the magic bytes and would reject a PNG-named
    // file whose contents are JPEG.
    const name = file.name.replace(/\.[^./\\]+$/, "") || "photo";
    return new File([blob], `${name}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
