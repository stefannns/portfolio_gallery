# Chibi capybara chef

Created with the **built-in image generation tool**, using transparent-background generation followed by an edit to give the character the requested Q版 / 3D手办 proportions.

Final assets in the requested project folder:

- `/Users/bytedance/Desktop/website/public/character/capybara-chef-chibi.png` — full-resolution transparent artwork, 1231 × 1278 pixels.
- `/Users/bytedance/Desktop/website/public/character/capybara-chef-chibi.webp` — compressed transparent version used by the website.
- `/Users/bytedance/Desktop/website/public/character/manifest.json` — poster and optional video clip paths.

This is rendered character artwork, not a rigged 3D model. The existing website motion is a small image animation, ready to be replaced by a finished character video.

## Final image edit prompt

Reference: the first generated capybara-chef character, retaining its chef clothing palette and friendly raised-paw gesture.

> Redesign the supplied capybara chef character into a much cuter Q版 / chibi 3D collectible figurine (3D手办风格), NOT a realistic animal. Keep its capybara identity, chef clothing palette, and friendly raised-paw gesture. Change the proportions substantially: an enormous rounded capybara head, very wide pudgy bean-shaped body and plump belly, tiny stubby legs with little round feet, very short chunky arms and tiny mitten-like paws. Overall body should be squat and broad, approximately 2-heads-tall including the body but not the chef hat. Think a beautifully sculpted high-end painted resin / soft vinyl art toy with simple smooth rounded forms, soft satin-matte material, very subtle surface texture and NO realistic individual fur strands. Broad blocky-round capybara muzzle, small black bead eyes, tiny rounded ears, small nostrils, a gentle happy mouth and rosy soft cheek color. Plump cloud-shaped white chef toque, chunky cream double-breasted chef jacket with only four small brass buttons, small terracotta triangular neckerchief, tiny charcoal apron over the fat round belly. Avoid a tall narrow torso and avoid thin long limbs. Both tiny paws held open in a welcoming 'controlling floating magical windows' pose, one slightly higher, no props. Full figurine clearly visible from hat to both feet, centered with generous padding; near-orthographic front three-quarter product rendering, slight view from above so its roundness reads. Premium toy photography lighting with warm soft key and delicate cool rim suitable for a dark website. Transparent alpha background, character cutout alone, no background, no floor, no cast shadow, no pedestal, no mirrors, no lettering or watermark.

## Seedance idle loop direction

Use the final PNG as the identity and proportions reference. Start with one six-second idle loop; gesture clips can follow later.

> Six-second seamless loop. Locked camera, complete chibi capybara chef centered, same outfit, silhouette, and squat figurine proportions as the supplied reference. Keep the oversized head, fat round belly, tiny limbs and feet, four brass buttons, and plump white chef hat consistent. Subtle breathing, one gentle blink, and a tiny welcoming paw motion, as if holding floating windows in place. Both feet remain planted. No walking, stretching, spinning, camera movement, zoom, new objects, mirrors, particles, or text. Begin and end in exactly the reference pose. Plain, evenly lit background suitable for clean background removal. Preserve the entire silhouette and leave padding above the toque and around the paws and feet.

Generate only the character. The rifts, fragments, and particles are already interactive website elements and should stay out of the video. If the video export is opaque, remove/matte the background before making browser-compatible transparent video exports. The site accepts an idle source and optional left, right, and enter sources in the manifest.
