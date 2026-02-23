/**
 * Prompt templates for model image generation (English).
 *
 * The garment type/color is NOT specified — the AI must strictly follow
 * the flat-lay reference photo for all garment details.
 */

export function frontPrompt({ additionalNotes } = {}) {
  const extra = additionalNotes ? `\nAdditional notes: ${additionalNotes}` : '';
  return `You are a professional e-commerce fashion photographer.

I am providing three images:
1. A front-facing reference photo of the model — you MUST generate a person who looks EXACTLY identical to this model (same face shape, body type, skin tone, hairstyle).
2. A flat-lay photo of a garment — you MUST strictly replicate this EXACT garment with ALL its details.
3. A pose reference photo — the model MUST adopt the EXACT same standing pose and body posture as shown in this photo.

Generate a professional e-commerce product photo where the model:
- Wears the EXACT same garment as shown in the flat-lay photo (match ALL details: color, fabric texture, patterns, buttons, zippers, stitching, collar style, sleeve length — do NOT alter anything)
- Adopts the EXACT same pose and body posture as the pose reference photo, but facing directly forward (front view)
- Has arms slightly away from the body so the garment silhouette is clearly visible
- Looks directly at the camera with a natural, confident expression

Photography requirements:
- Clean white or light gray studio background
- Soft, even studio lighting with no harsh shadows
- Full-body shot from head to below the knees
- Sharp, crisp garment details
- Professional e-commerce photography style (like ZARA or UNIQLO product pages)

CRITICAL: The garment MUST be an exact replica of the flat-lay photo — same color, same fabric, same design, same every detail. Do NOT guess or change anything about the garment. The model MUST look exactly like the reference photo.${extra}`;
}

export function detailPagePrompt() {
  return `You are a professional e-commerce graphic designer.

I am providing the following images:
1. A detail page reference image — this shows the EXACT layout, style, and design you MUST follow.
2. Model wearing photos — these are the product photos that should be used in the generated image.

Generate a new e-commerce detail page section image:
- STRICTLY follow the reference image's layout, composition, and visual style
- Replace the model/product images in the reference with the model wearing photos I provided
- Keep the SAME background style, color scheme, and overall aesthetics
- Keep the SAME proportions and spacing
- Output width must be 790px

CRITICAL: The layout and design style MUST be highly consistent with the reference image. Only the model/product photos need to be swapped. Maintain the professional e-commerce detail page aesthetics.`;
}

export function backPrompt({ additionalNotes } = {}) {
  const extra = additionalNotes ? `\nAdditional notes: ${additionalNotes}` : '';
  return `You are a professional e-commerce fashion photographer.

I am providing three images:
1. A back-facing reference photo of the model — you MUST generate a person who looks EXACTLY identical to this model from behind (same body type, skin tone, hairstyle, body proportions).
2. A flat-lay photo of a garment — you MUST strictly replicate this EXACT garment with ALL its details.
3. A pose reference photo — the model should adopt a SIMILAR standing pose, but shown from the back.

Generate a professional e-commerce product photo where the model:
- Wears the EXACT same garment as shown in the flat-lay photo (match ALL details: color, fabric texture, patterns, back design, stitching — do NOT alter anything)
- Stands with their back facing the camera (rear view), adopting a pose similar to the pose reference photo
- Has a natural standing posture, head may be slightly turned to show it is the same model
- Arms hanging naturally so the back of the garment is fully visible

Photography requirements:
- Clean white or light gray studio background (consistent with the front view)
- Soft, even studio lighting with no harsh shadows
- Full-body shot from head to below the knees
- Sharp, crisp garment back details
- Professional e-commerce photography style

CRITICAL: The garment MUST be an exact replica of the flat-lay photo — same color, same fabric, same design, same every detail. Do NOT guess or change anything about the garment. The model MUST be the same person as the reference photo. This is the back view of the same outfit.${extra}`;
}
