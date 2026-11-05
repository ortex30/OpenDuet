export interface OverlayRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface OverlayPopoverPosition {
  left: number;
  top: number;
  fitsWithoutOverlap: boolean;
}

interface HorizontalSegment {
  left: number;
  right: number;
}

/**
 * Places a calendar popup inside the viewport while treating open app tools
 * (the right rail and Rebound drawer) as unavailable space. Exclusions are
 * reduced to horizontal segments because those tools span the working height.
 */
export function overlaySafePopoverPosition(input: {
  anchor: OverlayRect;
  viewportWidth: number;
  viewportHeight: number;
  exclusions?: OverlayRect[];
  width?: number;
  estimatedHeight?: number;
  gap?: number;
  inset?: number;
}): OverlayPopoverPosition {
  const {
    anchor,
    viewportWidth,
    viewportHeight,
    exclusions = [],
    width = 420,
    estimatedHeight = 620,
    gap = 10,
    inset = 12,
  } = input;

  let segments: HorizontalSegment[] = [
    { left: inset, right: Math.max(inset, viewportWidth - inset) },
  ];

  for (const exclusion of exclusions) {
    if (exclusion.bottom <= inset || exclusion.top >= viewportHeight - inset) {
      continue;
    }
    const cutLeft = Math.max(inset, exclusion.left - gap);
    const cutRight = Math.min(viewportWidth - inset, exclusion.right + gap);
    segments = segments.flatMap((segment) => {
      if (cutRight <= segment.left || cutLeft >= segment.right)
        return [segment];
      const remaining: HorizontalSegment[] = [];
      if (cutLeft - segment.left >= width) {
        remaining.push({ left: segment.left, right: cutLeft });
      }
      if (segment.right - cutRight >= width) {
        remaining.push({ left: cutRight, right: segment.right });
      }
      return remaining;
    });
  }

  const desired = [anchor.right + gap, anchor.left - gap - width];
  const candidates = segments
    .filter((segment) => segment.right - segment.left >= width)
    .flatMap((segment) =>
      desired.map((preferred, preference) => {
        const left = Math.max(
          segment.left,
          Math.min(preferred, segment.right - width),
        );
        return {
          left,
          preference,
          distance: Math.abs(left - preferred),
        };
      }),
    )
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.preference - b.preference ||
        a.left - b.left,
    );

  const maxTop = Math.max(
    inset,
    viewportHeight -
      Math.min(estimatedHeight, viewportHeight - inset * 2) -
      inset,
  );
  const top = Math.max(inset, Math.min(anchor.top, maxTop));
  const best = candidates[0];
  if (best) {
    return { left: best.left, top, fitsWithoutOverlap: true };
  }

  return {
    left: Math.max(inset, Math.min(anchor.left, viewportWidth - width - inset)),
    top,
    fitsWithoutOverlap: false,
  };
}
