// Shared filled silhouettes for the HTML controls and canvas pins.
/** @type {Record<string, string>} */
export const sourcePaths = {
  wiki: "M3 4.5C6 3.5 9 4 11 5.5V21C8.5 19.5 6 19 3 20V4.5ZM13 5.5C15 4 18 3.5 21 4.5V20C18 19 15.5 19.5 13 21V5.5Z",
  reviews:
    "M12 2.5 15 8.6 21.7 9.6 16.85 14.3 18 21 12 17.85 6 21 7.15 14.3 2.3 9.6 9 8.6Z",
  video:
    "M5 4H19A3 3 0 0 1 22 7V17A3 3 0 0 1 19 20H5A3 3 0 0 1 2 17V7A3 3 0 0 1 5 4ZM10 8V16L16 12Z",
  social:
    "M12 3C6.5 3 2 6.7 2 11.3 2 13.8 3.3 16.1 5.5 17.6L4.5 22 9.7 19.3 12 19.5C17.5 19.5 22 15.8 22 11.3S17.5 3 12 3Z",
  property:
    "M12 2 1.5 11H4V20A2 2 0 0 0 6 22H10V15H14V22H18A2 2 0 0 0 20 20V11H22.5Z",
  people:
    "M12 2A4.5 4.5 0 1 1 12 11 4.5 4.5 0 0 1 12 2ZM4 21V19A8 7 0 0 1 20 19V21A1 1 0 0 1 19 22H5A1 1 0 0 1 4 21Z",
};

sourcePaths.osm = sourcePaths.property;
sourcePaths.places = sourcePaths.property;
sourcePaths.review = sourcePaths.reviews;
sourcePaths.census = sourcePaths.people;
sourcePaths.wikipedia = sourcePaths.wiki;

export const sourceIcon = (id) =>
  `<svg class="source-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${sourcePaths[id]}"/></svg>`;
