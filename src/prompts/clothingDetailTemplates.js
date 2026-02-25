/**
 * Prompt templates for clothing detail image replacement.
 *
 * Input: a detail reference photo (composition/angle/background) + N clothing photos (multi-angle).
 * Output: the same composition with the clothing replaced.
 */

export function clothingDetailPrompt({ additionalNotes, adjustmentPrompt, clothingCount = 1 } = {}) {
  const extra = additionalNotes ? `\nAdditional notes: ${additionalNotes}` : '';
  const adjustment = adjustmentPrompt ? `\nAdjustment request: ${adjustmentPrompt}` : '';

  const clothingDescription = clothingCount === 1
    ? `2. A real-world photo of the NEW clothing — this is the SOURCE CLOTHING to replace with. You MUST extract the EXACT clothing/fabric details from this photo.`
    : `2-${clothingCount + 1}. ${clothingCount} real-world photos of the SAME NEW clothing from different angles — these are the SOURCE CLOTHING references. You MUST comprehensively analyze ALL ${clothingCount} photos to extract the EXACT clothing/fabric details.`;

  const clothingInstruction = clothingCount === 1
    ? `- Match ALL clothing details precisely from the source: color, fabric texture, patterns, buttons, zippers, stitching, collar style, sleeve length, fit, drape, weave`
    : `- Combine information from ALL ${clothingCount} clothing reference photos to accurately reproduce every detail: color, fabric texture, patterns, buttons, zippers, stitching, collar style, sleeve length, fit, drape, weave
- Use the multiple angles to resolve any ambiguity about the garment's appearance`;

  return `You are a professional e-commerce clothing detail photo specialist.

I am providing ${clothingCount + 1} images:
1. A detail reference photo — this is the COMPOSITION TEMPLATE. You MUST keep EVERYTHING about this photo's composition: the exact camera angle, framing, background, lighting, props, hands (if any), and overall layout. This defines the EXACT output composition and dimensions.
${clothingDescription}

Generate a detail photo where:
- The OUTPUT IMAGE must have the EXACT SAME dimensions (width and height) as the detail reference photo (image 1)
- The composition, camera angle, framing, and layout are IDENTICAL to the detail reference photo
- The background, lighting, shadows, and atmosphere are IDENTICAL to the detail reference photo
- Any hands, fingers, props, mannequin parts, or non-clothing elements from the detail reference are PRESERVED exactly as they appear
- ONLY the clothing/fabric portion is replaced with the EXACT garment from the clothing reference photo(s)
- From the clothing reference photo(s), extract ONLY the clothing/fabric information — completely IGNORE the background, model, pose, lighting, and all other elements
${clothingInstruction}
- The replaced clothing/fabric should fit naturally into the original composition, following the same folds, draping, and positioning
- Maintain consistent lighting and shadows on the new clothing to match the scene
- The result should look like an authentic, professionally shot detail photo — NOT like a composite or edit

CRITICAL: Do NOT change the composition, angle, background, lighting, or any non-clothing elements. Do NOT alter any clothing details from the source photo(s). The ONLY change is replacing the clothing/fabric. The clothing reference photo(s) are used SOLELY for clothing/fabric extraction — nothing else. The result must be photorealistic and seamless, with the same image dimensions as the detail reference photo.${extra}${adjustment}`;
}
