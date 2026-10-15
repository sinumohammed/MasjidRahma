import { useEffect, useState, type RefObject } from 'react';

// The height that makes an element end at the bottom of the screen the user
// actually sees - so the Assistant's typing box is always in view. A fixed
// guess like `100vh - 300px` is wrong on phones: 100vh is taller than the
// visible area while the browser bars show, and does not shrink when the
// keyboard opens. visualViewport does (the part of the page on screen now),
// so the chat gets shorter above the keyboard and the box stays reachable.
// Recomputed on resize, rotation, keyboard open/close and visual-viewport
// scroll. `bottomGap`: space to leave below (px); `min`: never shorter.
export function useFitToViewport(ref: RefObject<HTMLElement | null>, { bottomGap = 0, min = 320 } = {}) {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const vv = window.visualViewport;
        // The visible bottom, in the same coordinates as getBoundingClientRect.
        const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
        const top = el.getBoundingClientRect().top;
        setHeight(Math.max(min, Math.floor(visibleBottom - top - bottomGap)));
      });
    };
    measure();
    // Layout above the chat can settle after mount (fonts, header, drawer animation).
    const late = window.setTimeout(measure, 350);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(late);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [ref, bottomGap, min]);

  return height;
}
