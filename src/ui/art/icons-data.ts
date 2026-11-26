/**
 * The UI icon set (GDD §11: "a drawn SVG icon set, no emoji"). One 24px grid, ink-on-paper
 * woodcut style: 1.7px round strokes in currentColor plus solid filled masses (marked with
 * `fill="currentColor"`), so every icon prints in one ink and recolours with its text.
 *
 * Pure data (no DOM) so tests can check that every name the UI uses exists. Rendered by
 * src/ui/art/Icon.tsx. Add an icon by adding a key; aliases map game words to drawings.
 */
const F = 'fill="currentColor" stroke="none"';

const DRAWINGS = {
  // --- Yields -------------------------------------------------------------
  food: `<path d="M12 22V8"/><path ${F} d="M12 8.6c-1.7-1.3-1.9-3.6-.1-5.8 1.9 2.2 1.7 4.5.1 5.8z"/><path ${F} d="M11.5 12.6c-2.7.3-4.6-1-5.1-3.6 2.6-.3 4.5 1 5.1 3.6zM11.5 16.8c-2.7.3-4.6-1-5.1-3.6 2.6-.3 4.5 1 5.1 3.6zM12.5 12.6c2.7.3 4.6-1 5.1-3.6-2.6-.3-4.5 1-5.1 3.6zM12.5 16.8c2.7.3 4.6-1 5.1-3.6-2.6-.3-4.5 1-5.1 3.6z"/><path d="M8.5 22h7"/>`,
  production: `<path stroke-width="2.4" d="M4.5 20l8.2-8.2"/><path ${F} d="M10.4 7.2l3.8-3.7 2.3.6 4.2 4.2-2.6 2.6-2.2-1.3-2.4 2.4z"/><path d="M3 21.5h5"/>`,
  gold: `<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="5.6" stroke-dasharray=".01 2.2" stroke-width="1.9"/><path ${F} d="M10.2 10.2h3.6v3.6h-3.6z"/>`,
  science: `<circle cx="12" cy="13" r="7.6"/><circle cx="12" cy="13" r="4.6" stroke-width="1"/><path d="M6 18.2l12-10.4"/><circle ${F} cx="12" cy="13" r="1.6"/><path d="M12 5.4V3.4"/><circle cx="12" cy="2.4" r="1"/><path stroke-width="1.2" d="M12 6.4v1.3M18.6 13h-1.3M5.4 13h1.3M12 19.6v-1.3"/>`,
  culture: `<path d="M7.3 3.5C4.6 7 5 12.6 8.4 15.5h7.2c3.4-2.9 3.8-8.5 1.1-12"/><path d="M5.6 6.2h12.8"/><path stroke-width="1.1" d="M10 6.2v9.3M12 6.2v9.3M14 6.2v9.3"/><path ${F} d="M7.6 15.5h8.8l-.9 3.2c-.2.8-.9 1.3-1.7 1.3h-3.6c-.8 0-1.5-.5-1.7-1.3z"/><path d="M8.5 21.5h7"/>`,
  faith: `<path ${F} fill-rule="evenodd" d="M12 2.6c2.8 3.2 4.3 5.4 4.3 8a4.3 4.3 0 0 1-8.6 0c0-2.6 1.5-4.8 4.3-8zm0 5.8c-1.1 1.3-1.7 2.2-1.7 3.2a1.7 1.7 0 0 0 3.4 0c0-1-.6-1.9-1.7-3.2z"/><path ${F} d="M4.5 15.5h15c-.5 3.4-3.6 5.4-7.5 5.4s-7-2-7.5-5.4z"/>`,
  happiness: `<circle ${F} cx="12" cy="12" r="4.4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>`,
  influence: `<path d="M4 6.5h13.5v12H4z"/><path d="M4 6.5l6.8 6 6.7-6"/><circle ${F} cx="17.5" cy="17" r="3.6"/><path d="M15.8 20l-1 2.6M19.2 20l1 2.6"/>`,
  // --- Moods (happiness states) ------------------------------------------
  moodHigh: `<circle ${F} cx="12" cy="12" r="4.6"/><path d="M12 1.8v3.6M12 18.6v3.6M1.8 12h3.6M18.6 12h3.6M4.8 4.8l2.5 2.5M16.7 16.7l2.5 2.5M4.8 19.2l2.5-2.5M16.7 7.3l2.5-2.5"/>`,
  moodOk: `<circle cx="12" cy="12" r="4.4"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7"/>`,
  moodLow: `<circle cx="9" cy="9" r="3.6"/><path d="M9 2.4v1.6M2.4 9H4M4.3 4.3l1.1 1.1M13.7 4.3l-1.1 1.1"/><path ${F} d="M8 20a3.6 3.6 0 0 1-.2-7.2 5 5 0 0 1 9.5.9 3.2 3.2 0 0 1 .3 6.3z"/>`,
  moodBad: `<path ${F} d="M6.5 15a4 4 0 0 1-.1-8 5.3 5.3 0 0 1 10.2 1A3.5 3.5 0 0 1 17 15z"/><path stroke-width="2" d="M12.5 15.5l-2.2 3.4h3l-2 3.4"/>`,
  // --- Figure kinds -------------------------------------------------------
  general: `<path ${F} d="M12 2.2l1.7 2.2V15h-3.4V4.4z"/><path stroke-width="2.2" d="M7 15.6h10"/><path stroke-width="2.2" d="M12 16v4"/><circle ${F} cx="12" cy="21.3" r="1.3"/>`,
  statesman: `<path d="M8.5 20C4.2 17 3.4 10.5 6.4 5.6M15.5 20c4.3-3 5.1-9.5 2.1-14.4"/><path ${F} d="M6.1 17.6c-1.9 0-3-1-3.3-2.6 1.9-.2 3 .7 3.3 2.6zM4.7 13.6c-1.7-.6-2.4-1.9-2.1-3.5 1.7.5 2.5 1.8 2.1 3.5zM4.8 9.5c-1.3-1-1.5-2.4-.7-3.8 1.3 1 1.5 2.4.7 3.8zM17.9 17.6c1.9 0 3-1 3.3-2.6-1.9-.2-3 .7-3.3 2.6zM19.3 13.6c1.7-.6 2.4-1.9 2.1-3.5-1.7.5-2.5 1.8-2.1 3.5zM19.2 9.5c1.3-1 1.5-2.4.7-3.8-1.3 1-1.5 2.4-.7 3.8z"/><path d="M8.5 20h7"/><circle ${F} cx="12" cy="11" r="2.2"/>`,
  thinker: `<path d="M12 6.6C10 5 7 4.5 3.2 5v13.2c3.8-.5 6.8 0 8.8 1.6 2-1.6 5-2.1 8.8-1.6V5C17 4.5 14 5 12 6.6z"/><path d="M12 6.6v13.2"/><path stroke-width="1.1" d="M5.5 8.4c1.8-.2 3.4 0 4.6.6M5.5 11.4c1.8-.2 3.4 0 4.6.6M5.5 14.4c1.8-.2 3.4 0 4.6.6M18.5 8.4c-1.8-.2-3.4 0-4.6.6M18.5 11.4c-1.8-.2-3.4 0-4.6.6"/>`,
  spiritual: `<path ${F} d="M2.8 13.2h13.4l2.4-1.8h2.8c-.8 4-4.6 6.6-9.6 6.6-4.6 0-8-2-9-4.8z"/><path d="M8 18v2.6h6V18"/><path ${F} d="M19.6 10.6c-1.4-1.1-1.5-2.9-.1-4.8 1.4 1.9 1.4 3.7.1 4.8z"/><path d="M4.2 13.2c-1-1.2-1.4-2.4-.8-3.6"/>`,
  builder: `<path d="M4.5 21.5V11a7.5 7.5 0 0 1 15 0v10.5"/><path d="M8 21.5V11.3a4 4 0 0 1 8 0v10.2"/><path ${F} d="M10.7 3.6h2.6l-.4 3.6h-1.8z"/><path stroke-width="1.1" d="M4.5 15h3.5M16 15h3.5M4.5 18.5h3.5M16 18.5h3.5M5.6 7.2l2.9 2.1M18.4 7.2l-2.9 2.1"/><path d="M3 21.5h18"/>`,
  explorer: `<circle cx="12" cy="12" r="9" stroke-width="1.2"/><path ${F} d="M12 2.2l2 7.8-2 2-2-2zM12 21.8l-2-7.8 2-2 2 2zM2.2 12l7.8-2 2 2-2 2zM21.8 12l-7.8 2-2-2 2-2z"/><path stroke-width="1" d="M12 2.2l2 7.8 7.8 2-7.8 2-2 7.8-2-7.8L2.2 12 10 10z"/>`,
  legend: `<path ${F} d="M12 1.8l1.9 6.4 5.9-3.3-3.2 5.9 6.4 1.9-6.4 1.9 3.2 5.9-5.9-3.3L12 22.2l-1.9-6.4-5.9 3.3 3.2-5.9L1 12l6.4-1.9-3.2-5.9 5.9 3.3z"/>`,
  // --- Unit classes -------------------------------------------------------
  infantry: `<path stroke-width="1.8" d="M19.5 2.5L7 20.5"/><path ${F} d="M19.8 2.1l-.5 4.1-2.8-1.9z"/><circle ${F} cx="9" cy="13.5" r="5.8"/><circle cx="9" cy="13.5" r="7.2" stroke-width="1"/>`,
  ranged: `<path d="M7.5 2.5c6.5 3.2 6.5 15.8 0 19"/><path stroke-width="1" d="M7.5 2.5v19"/><path d="M3.2 12h15.5"/><path ${F} d="M21.2 12l-3.6 2.2v-4.4z"/><path d="M3.2 12L1.8 10.4M3.2 12l-1.4 1.6M5 12l-1.4-1.6M5 12l-1.4 1.6"/>`,
  cavalry: `<path ${F} d="M7 21.5c0-4.2.8-7.2 2.8-9.4-1.8-.6-3.3-2.2-3.2-4.3l3.7-1.5 2.6-3.6 1.3 2.6c3.3 1.1 5.8 4.3 5.8 8l-2.1.9-3-1.9c-.6 3.2-.3 6.3.5 9.2z"/><path d="M12.6 6.6c-1.4.5-2.6 1.4-3.3 2.6"/>`,
  siege: `<path d="M2.5 19h17"/><circle ${F} cx="6.5" cy="19.2" r="2.3"/><circle ${F} cx="15.5" cy="19.2" r="2.3"/><path d="M9 19l2.5-6.5L14 19"/><path stroke-width="2" d="M8 15.5L18.5 5.5"/><circle ${F} cx="19.2" cy="4.8" r="2"/>`,
  naval: `<path ${F} d="M2.5 15h19l-3.2 5.5H5.7z"/><path d="M11.5 15V2.5"/><path ${F} d="M12.4 4c3.7 1.6 5.8 4.8 6 9h-6z"/><path ${F} d="M10.6 6.2v6.8H5.2c.3-3 2.4-5.6 5.4-6.8z"/><path ${F} d="M11.5 2.5l3 1-3 1z"/>`,
  civilian: `<path ${F} d="M4.5 13V9.6C4.5 6.4 8 4.6 12 4.6s7.5 1.8 7.5 5V13z"/><path stroke-width="1.1" d="M9 5.4V13M15 5.4V13"/><path ${F} d="M3 13h18v2.6H3z"/><circle cx="7.4" cy="18.6" r="2.5"/><circle cx="16.6" cy="18.6" r="2.5"/>`,
  commander: `<path d="M6 21.5V2.5"/><path ${F} d="M6.6 3.5h12.6l-3.4 4.2 3.4 4.2H6.6z"/><path d="M3.5 21.5h5"/>`,
  // --- Actions ------------------------------------------------------------
  move: `<path d="M4 19.5c2.6-7.8 8.4-11.3 15-11.3"/><path ${F} d="M20.5 8.2l-4.6 3V5.2z"/><circle ${F} cx="4.2" cy="19.6" r="1.6"/>`,
  attack: `<path stroke-width="1.9" d="M4.5 3.5l11.5 11.5M19.5 3.5L8 15"/><path stroke-width="2.2" d="M12.8 17.6l4.6-4.6M6.6 13l4.6 4.6"/><path stroke-width="2.4" d="M16.8 17.2l2.6 2.6M7.2 17.2l-2.6 2.6"/><path ${F} d="M3.6 2.6l3 .6-2.4 2.4zM20.4 2.6l-3 .6 2.4 2.4z"/>`,
  fortify: `<path ${F} fill-rule="evenodd" d="M12 2.5l8 2.8v6c0 5.4-3.5 9.2-8 10.9-4.5-1.7-8-5.5-8-10.9v-6zm0 2.3v15.1c3.2-1.5 5.7-4.5 5.7-8.6V6.8z"/>`,
  skip: `<path ${F} d="M15.5 3.2A9 9 0 1 0 20.8 15 7.2 7.2 0 0 1 15.5 3.2z"/><path stroke-width="1.2" d="M18 4.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/>`,
  found: `<path d="M4 21V11.5l8-6 8 6V21z"/><path ${F} d="M10 21v-5.5h4V21z"/><path d="M12 5.5V1.8"/><path ${F} d="M12.4 1.6l3.6 1.3-3.6 1.3z"/><path d="M2.5 21h19"/>`,
  trade: `<path d="M12 3v17"/><path d="M7.5 21h9"/><path d="M3.5 6.5h17"/><path stroke-width="1.1" d="M5 6.5l-2.6 6.3M5 6.5l2.6 6.3M19 6.5l-2.6 6.3M19 6.5l2.6 6.3"/><path ${F} d="M1.6 12.8h6.8a3.4 3.4 0 0 1-6.8 0zM15.6 12.8h6.8a3.4 3.4 0 0 1-6.8 0z"/><circle ${F} cx="12" cy="3.4" r="1.4"/>`,
  disband: `<path stroke-width="2.4" d="M3.5 20.5l2.6-2.6"/><path stroke-width="2.2" d="M5 14.5l4.5 4.5"/><path ${F} d="M7.2 15.4l3.6-3.6 1.6.4-.6 1.2 1.4.3-3.8 3.9z"/><path ${F} d="M14.4 9.6l.9-1.4 1.1.6 3.9-4.6.9-.9-.6 2.6-4.1 4.5-.9-.3z"/><path stroke-width="1.1" d="M13.4 13.6l1.6 1.2M15.6 11.8l2 .4M12 15.6l.4 2"/>`,
  deploy: `<path d="M15 3.5h5.5v17H15"/><path stroke-width="2" d="M2.5 12h11"/><path ${F} d="M15.6 12l-4.8 3.6V8.4z"/>`,
  recall: `<path d="M9 3.5H3.5v17H9"/><path stroke-width="2" d="M21.5 12h-11"/><path ${F} d="M7.4 12l4.8 3.6V8.4z"/>`,
  seat: `<path d="M6.5 21.5V12.5h11v9"/><path ${F} d="M7.5 12.5V4.6c0-1.4 9-1.4 9 0v7.9z"/><path stroke-width="2.2" d="M4.5 13.5h15"/><path d="M6.5 17h11"/>`,
  activate: `<path ${F} d="M12 1.8l2.1 7.1 7.1 3.1-7.1 3.1-2.1 7.1-2.1-7.1L2.8 12l7.1-3.1z"/><path stroke-width="1.2" d="M19 3l.5 1.5L21 5l-1.5.5L19 7l-.5-1.5L17 5l1.5-.5zM5 17l.5 1.5L7 19l-1.5.5L5 21l-.5-1.5L3 19l1.5-.5z"/>`,
  consume: `<path ${F} d="M9.5 10.5h5v10.5h-5z"/><path d="M7 21.5h10"/><path stroke-width="1.3" d="M12 8.5c-1.3-1.4.9-2.4-.1-4 1.3 1.1 1.6 2.2.6 3.2M14.5 6.8c-.8-.9.5-1.6-.1-2.6"/>`,
  // --- HUD ----------------------------------------------------------------
  menu: `<path stroke-width="2" d="M4 6.5h16M4 12h16M4 17.5h16"/>`,
  endTurn: `<path d="M2.5 17.5h19"/><path ${F} d="M6.6 17.5a5.4 5.4 0 0 1 10.8 0z"/><path d="M12 7.5v2.2M5.6 10.4l1.5 1.5M18.4 10.4l-1.5 1.5M3.2 14.2h1.8M19 14.2h1.8"/><path stroke-width="1.2" d="M6 20.5h12"/>`,
  next: `<path stroke-width="2.2" d="M9 5l7 7-7 7"/>`,
  back: `<path stroke-width="2.2" d="M15 5l-7 7 7 7"/>`,
  figures: `<circle ${F} cx="9" cy="7.8" r="3.4"/><path ${F} d="M2.5 21c0-4.8 2.8-8 6.5-8s6.5 3.2 6.5 8z"/><circle cx="16.4" cy="8.6" r="2.8"/><path d="M15.4 13.4c3.4-.2 6 2.4 6.1 6.8h-4"/>`,
  cabinet: `<path ${F} d="M2.5 8.8L12 3.2l9.5 5.6z"/><path stroke-width="2" d="M5.5 10.5v8M10 10.5v8M14 10.5v8M18.5 10.5v8"/><path stroke-width="2" d="M3 20.6h18"/><path d="M4 9.4h16"/>`,
  research: `<path ${F} d="M5 15.5h7.5l.8 6H4.2z"/><path d="M8.7 15.5L19.8 2.6c1 2.6.3 6.4-3.8 9.4l-6 4.3"/><path stroke-width="1.1" d="M12.2 11.4l3.2-1M14.2 9l3-.8"/>`,
  nations: `<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9" stroke-width="1.2"/><path stroke-width="1.2" d="M3 12h18M4.6 7h14.8M4.6 17h14.8"/>`,
  legacy: `<path ${F} d="M10.2 20l.9-14.2L12 3.5l.9 2.3.9 14.2z"/><path stroke-width="2" d="M6.5 21h11"/><path d="M8 20h8"/><path stroke-width="1.1" d="M5 9c-1-2.6.2-4.8 2.4-5.6M19 9c1-2.6-.2-4.8-2.4-5.6"/>`,
  save: `<path d="M6 3h11.5a1 1 0 0 1 1 1v17H7a1 1 0 0 1-1-1z"/><path d="M8.5 3v18"/><path ${F} d="M13.5 3v7l1.8-1.6 1.8 1.6V3z"/>`,
  settings: `<circle cx="12" cy="12" r="5.8"/><circle ${F} cx="12" cy="12" r="2.2"/><path stroke-width="2.6" d="M12 2.4v3M12 18.6v3M2.4 12h3M18.6 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M5.2 18.8l2.1-2.1M16.7 7.3l2.1-2.1"/>`,
  soundOn: `<path ${F} d="M2.8 9.2h3.6L12 4.6v14.8l-5.6-4.6H2.8z"/><path d="M15 9a4.2 4.2 0 0 1 0 6M17.6 6.4a8 8 0 0 1 0 11.2"/>`,
  soundOff: `<path ${F} d="M2.8 9.2h3.6L12 4.6v14.8l-5.6-4.6H2.8z"/><path stroke-width="2" d="M15.5 9l5.5 6M21 9l-5.5 6"/>`,
  close: `<path stroke-width="2" d="M6 6l12 12M18 6L6 18"/>`,
  dice: `<path d="M12 2.8l8 4.5v9.4L12 21.2l-8-4.5V7.3z"/><path d="M4 7.3l8 4.5 8-4.5M12 11.8v9.4"/><circle ${F} cx="12" cy="7.2" r="1.2"/><circle ${F} cx="7.4" cy="12.6" r="1.1"/><circle ${F} cx="8.8" cy="16.4" r="1.1"/><circle ${F} cx="15.4" cy="13.4" r="1.1"/><circle ${F} cx="17.2" cy="16" r="1.1"/>`,
  check: `<path stroke-width="2.2" d="M4.5 12.5l4.8 4.8L19.5 7"/>`,
  plus: `<path stroke-width="2" d="M12 5v14M5 12h14"/>`,
  help: `<circle cx="12" cy="12" r="8.8"/><path stroke-width="2" d="M9.2 9.4c.3-1.7 1.5-2.6 3-2.6 1.7 0 3 1.1 3 2.6 0 2.2-3.1 2.3-3.1 4.6"/><circle ${F} cx="12.1" cy="17.1" r="1.3"/>`,
  chronicle: `<path d="M8 4.5h11v12.8a2.2 2.2 0 0 1-2.2 2.2H5.4"/><path ${F} d="M3.2 17.3a2.2 2.2 0 0 0 2.2 2.2 2.2 2.2 0 0 0 0-4.4h11.4v-.1"/><path d="M8 4.5a2 2 0 1 0-4 0v3.2h4"/><path stroke-width="1.1" d="M10.5 8.5h6M10.5 11h6M10.5 13.5h4"/>`,
  play: `<path ${F} d="M7 4.5l12.5 7.5L7 19.5z"/>`,
  quit: `<path d="M5.5 3h10v18h-10z"/><circle ${F} cx="12.8" cy="12" r="1.1"/><path d="M15.5 3l3.5 1.6v14.8L15.5 21"/>`,
  upgrade: `<path d="M4 21V12l8-6 8 6v9z"/><path stroke-width="2" d="M12 19v-8"/><path ${F} d="M12 8.6l3.4 3.6H8.6z"/>`,
  river: `<path d="M3 8.5c2-2 4 2 6 0s4 2 6 0 4 2 6 0M3 13c2-2 4 2 6 0s4 2 6 0 4 2 6 0M3 17.5c2-2 4 2 6 0s4 2 6 0 4 2 6 0"/>`,
  heart: `<path ${F} d="M12 20.6s-8-4.8-8-10.6A4.4 4.4 0 0 1 12 7.6 4.4 4.4 0 0 1 20 10c0 5.8-8 10.6-8 10.6z"/>`,
  // --- Status -------------------------------------------------------------
  war: `<path stroke-width="1.8" d="M4 20.5L17.5 7M20 20.5L6.5 7"/><path ${F} d="M20.2 3.8l-.7 5-4.3-4.3zM3.8 3.8l.7 5 4.3-4.3z"/><path stroke-width="2.2" d="M5.5 16.5l2 2M18.5 16.5l-2 2"/>`,
  peace: `<path d="M4 20.5C8.5 16.5 13.5 10 19.5 3.5"/><path ${F} d="M8.4 15.8c-2.3.6-4.2-.3-5.2-2.3 2.3-.6 4.2.3 5.2 2.3zM10.6 13.1c-.5-2.3.4-4.2 2.4-5.2.5 2.3-.4 4.2-2.4 5.2zM12.4 11c2.3.6 4.2-.3 5.2-2.3-2.3-.6-4.2.3-5.2 2.3zM14.6 8.1c-.5-2.3.4-4.2 2.4-5.2.5 2.3-.4 4.2-2.4 5.2zM7.4 18.7c-.2-2 .8-3.6 2.7-4.2.2 2-.8 3.6-2.7 4.2z"/>`,
  crisis: `<path ${F} d="M6.5 14.5a4.2 4.2 0 0 1-.1-8.4A5.5 5.5 0 0 1 17 7.2a3.7 3.7 0 0 1 .3 7.3z"/><path ${F} d="M12.8 13.6l-3.4 5h2.8l-1.6 4 4.6-5.8h-2.9l1.7-3.2z"/>`,
  age: `<path stroke-width="2" d="M6 2.8h12M6 21.2h12"/><path d="M7.5 2.8c0 5.4 9 5.4 9 9.2s-9 3.8-9 9.2M16.5 2.8c0 5.4-9 5.4-9 9.2s9 3.8 9 9.2"/><path ${F} d="M9.3 19.6c0-2 2.7-3.2 2.7-3.2s2.7 1.2 2.7 3.2zM10 7.6h4c-.6.9-1.3 1.4-2 1.9-.7-.5-1.4-1-2-1.9z"/>`,
  turn: `<circle cx="12" cy="12" r="8.8"/><path stroke-width="1.1" d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M5.8 5.8l1.4 1.4M16.8 16.8l1.4 1.4M5.8 18.2l1.4-1.4M16.8 7.2l1.4-1.4"/><path stroke-width="2" d="M12 12V7.4M12 12l3.2 2"/><circle ${F} cx="12" cy="12" r="1.4"/>`,
  locked: `<path ${F} d="M5.5 10.8h13v10.2h-13z"/><path stroke-width="2" d="M8.4 10.8V8a3.6 3.6 0 0 1 7.2 0v2.8"/>`,
  done: `<circle cx="12" cy="12" r="9"/><path stroke-width="2.2" d="M7.5 12.3l3.2 3.2 5.8-6.2"/>`,
  warning: `<path d="M12 3l9.6 17H2.4z"/><path stroke-width="2.2" d="M12 9.5v5"/><circle ${F} cx="12" cy="17.4" r="1.3"/>`,
  star: `<path ${F} d="M12 2.6l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z"/>`,
  starEmpty: `<path d="M12 2.6l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z"/>`,
} as const;

export type IconName = keyof typeof DRAWINGS;

/** Words the game uses for things that share a drawing. */
const ALIASES = {
  capital: 'star',
  strength: 'attack',
  moves: 'move',
  health: 'heart',
  envoy: 'influence',
  buy: 'gold',
  unseat: 'recall',
  government: 'cabinet',
  load: 'save',
  chevron: 'next',
  tech: 'science',
  civic: 'culture',
  milestone: 'star',
} as const satisfies Record<string, IconName>;

export type IconAlias = keyof typeof ALIASES;
export type AnyIconName = IconName | IconAlias;

export const ICON_NAMES = Object.keys(DRAWINGS) as IconName[];

export const iconMarkup = (name: AnyIconName): string => {
  const key: IconName = name in ALIASES ? ALIASES[name as IconAlias] : (name as IconName);
  return DRAWINGS[key];
};

export const hasIcon = (name: string): name is AnyIconName => name in DRAWINGS || name in ALIASES;
