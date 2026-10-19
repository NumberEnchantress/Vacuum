// unfamiliar sounds pictures: turns a derived picture (palette indices, shapes, turns)
// into SVG markup. Every color comes from the palette by index; nothing is
// computed from raw bits.
//
// Every picture has a thin light outline: palette black (#1A1A1A) is almost
// Spotify's background (#121212) and would otherwise vanish into the page.

(function (root) {
  "use strict";

  // Shapes drawn in a 50 x 50 square, nudged off-centre so that the quarter
  // turn also moves symmetric shapes (circle, square, ring, cross) to one of
  // four positions.
  const SHAPE_SVG = {
    "circle":    (c) => `<circle cx="21" cy="21" r="13" fill="${c}"/>`,
    "square":    (c) => `<rect x="9" y="9" width="24" height="24" fill="${c}"/>`,
    "triangle":  (c) => `<polygon points="25,7 42,38 8,38" fill="${c}"/>`,
    "diamond":   (c) => `<polygon points="21,5 37,21 21,37 5,21" fill="${c}"/>`,
    "half-disc": (c) => `<path d="M9,31 A16,16 0 0 1 41,31 Z" fill="${c}"/>`,
    "ring":      (c) => `<circle cx="21" cy="21" r="11" fill="none" stroke="${c}" stroke-width="7"/>`,
    "bar":       (c) => `<rect x="7" y="13" width="36" height="11" fill="${c}"/>`,
    "cross":     (c) => `<path d="M17,7h9v10h10v9h-10v10h-9v-10h-10v-9h10z" fill="${c}"/>`,
  };

  // Relative ring widths, outermost first. Every profile keeps the outer
  // rings wide so the picture still reads at small sizes.
  const RING_PROFILES = [
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1.6, 1.4, 1.2, 1, 0.9, 0.8, 0.7, 0.8],
    [1.4, 0.7, 1.4, 0.7, 1.3, 0.7, 1.1, 0.9],
    [2.2, 1, 1, 0.8, 0.8, 0.7, 0.6, 1],
  ];

  // Drawn in screen pixels whatever the picture's size (non-scaling stroke).
  const OUTLINE = 'fill="none" stroke="#FFFFFF" stroke-opacity="0.4" stroke-width="1.5" vector-effect="non-scaling-stroke"';

  function coverSvg(picture, palette, size) {
    const cells = picture.squares.map((s, i) => {
      const x = (i % 2) * 50, y = Math.floor(i / 2) * 50;
      return `<g transform="translate(${x} ${y})">` +
        `<rect width="50" height="50" fill="${palette[s.background]}"/>` +
        `<g transform="rotate(${s.turn * 90} 25 25)">${SHAPE_SVG[s.shape](palette[s.color])}</g></g>`;
    }).join("");
    const outline = `<rect x="0.5" y="0.5" width="99" height="99" ${OUTLINE}/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img">${cells}${outline}</svg>`;
  }

  function ringsSvg(picture, palette, size) {
    const weights = RING_PROFILES[picture.profile];
    const total = weights.reduce((a, b) => a + b, 0);
    let r = 50;
    const circles = picture.rings.map((color, i) => {
      const circle = `<circle cx="50" cy="50" r="${r.toFixed(2)}" fill="${palette[color]}"/>`;
      r -= (50 * weights[i]) / total;
      return circle;
    }).join("");
    const outline = `<circle cx="50" cy="50" r="49.5" ${OUTLINE}/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img">${circles}${outline}</svg>`;
  }

  function pictureSvg(picture, palette, size = 100) {
    return picture.kind === "rings" ? ringsSvg(picture, palette, size) : coverSvg(picture, palette, size);
  }

  // For <img src>.
  function pictureDataUrl(picture, palette, size = 640) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(pictureSvg(picture, palette, size));
  }

  const api = Object.freeze({ pictureSvg, pictureDataUrl, RING_PROFILES, SHAPES: Object.keys(SHAPE_SVG) });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UnfamiliarPictures = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
