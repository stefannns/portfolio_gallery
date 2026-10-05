export function computeGroupPlacements({ bounds, slots }) {
  const validBounds = bounds.filter(Boolean);
  if (validBounds.length === 0) return bounds.map(() => null);

  const maxWidth = Math.max(...validBounds.map((item) => item.width));
  const maxHeight = Math.max(...validBounds.map((item) => item.height));

  return bounds.map((item, index) => {
    if (!item) return null;
    const slot = slots[index] || slots[0];
    const scale = Math.min(slot.width / maxWidth, slot.height / maxHeight);
    const width = item.width * scale;
    const height = item.height * scale;
    const centerX = slot.x + slot.width / 2;
    const centerY = slot.y + slot.height / 2;
    const left = centerX - width / 2;
    const top = centerY - height / 2;

    return {
      sourceX: item.x,
      sourceY: item.y,
      sourceWidth: item.width,
      sourceHeight: item.height,
      left,
      top,
      width,
      height,
      centerX,
      centerY,
      right: left + width,
      bottom: top + height
    };
  });
}
