/**
 * Prompt templates for clothing swap / retouch image generation.
 *
 * Input: a model reference photo + N real-world clothing photos (multi-angle).
 * Output: the model wearing the clothing from the real photos.
 */

export function retouchPrompt({ additionalNotes, adjustmentPrompt, clothingCount = 1 } = {}) {
  const extra = additionalNotes ? `\nAdditional notes: ${additionalNotes}` : '';
  const adjustment = adjustmentPrompt ? `\nAdjustment request: ${adjustmentPrompt}` : '';

  const clothingDescription = clothingCount === 1
    ? `2. A real-world photo of clothing being worn — this is the SOURCE CLOTHING. You MUST extract the EXACT clothing from this photo and swap it onto the model.`
    : `2-${clothingCount + 1}. ${clothingCount} real-world photos of the SAME clothing being worn from different angles — these are the SOURCE CLOTHING references. You MUST comprehensively analyze ALL ${clothingCount} photos to extract the EXACT clothing details and swap the clothing onto the model.`;

  const clothingInstruction = clothingCount === 1
    ? `- Match ALL clothing details precisely: color, fabric texture, patterns, buttons, zippers, stitching, collar style, sleeve length, fit, drape`
    : `- Combine information from ALL ${clothingCount} clothing reference photos to accurately reproduce every detail: color, fabric texture, patterns, buttons, zippers, stitching, collar style, sleeve length, fit, drape
- Use the multiple angles to resolve any ambiguity about the garment's appearance`;

  return `You are a professional e-commerce fashion photo retoucher.

I am providing ${clothingCount + 1} images:
1. A professionally shot model photo — this is the TARGET TEMPLATE. You MUST keep EVERYTHING from this photo: the model's face, expression, body shape, skin tone, hairstyle, pose, background, lighting, composition, and overall atmosphere.
${clothingDescription}

Generate a retouched photo where:
- The OUTPUT IMAGE must have the EXACT SAME dimensions (width and height) as the model reference photo (image 1)
- The model looks EXACTLY the same as in the first photo (same face, expression, pose, body proportions)
- The background, lighting, and composition are IDENTICAL to the first photo
- ONLY the clothing is replaced with the EXACT garment from the clothing reference photo(s)
- From the clothing reference photo(s), extract ONLY the clothing information — completely IGNORE the background, model, pose, lighting, body shape, and all other elements in the clothing reference photo(s)
${clothingInstruction}
- The clothing should fit naturally on the model's body, following the original pose
- Maintain consistent lighting and shadows on the new clothing to match the scene
- The result should look like an authentic, professionally shot photo — NOT like a composite or edit

CRITICAL: Do NOT change the model's face, hair, skin, pose, or background. Do NOT alter any clothing details from the source photo(s). The ONLY change is swapping the clothing. The clothing reference photo(s) are used SOLELY for clothing extraction — nothing else. The result must be photorealistic and seamless, with the same image dimensions as the model reference photo.${extra}${adjustment}`;
}
