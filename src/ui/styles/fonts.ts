/**
 * Bundled typefaces (offline PWA: the woff2 files are emitted by Vite and precached by the
 * service worker). Only the subsets the game needs are declared, to keep the install small:
 *
 * - 'Fraunces' (display: titles, names, buttons): latin + latin-ext, upright and italic.
 * - 'Source Serif 4' (text: body, numbers): latin + latin-ext + greek, upright and italic.
 *
 * latin-ext covers the transliterations in content (ā ī ū ḥ ʿ ʾ þ ð ġ ǎ ē…); scripts outside
 * these ranges (天下, धर्म, mꜣꜥt's Egyptological letters) fall back to the system fonts listed in
 * base.css. Weight is a variable axis (100–900 / 200–900), so one file per subset and style.
 */
import frauncesLatin from '@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2?url';
import frauncesLatinExt from '@fontsource-variable/fraunces/files/fraunces-latin-ext-wght-normal.woff2?url';
import frauncesLatinIt from '@fontsource-variable/fraunces/files/fraunces-latin-wght-italic.woff2?url';
import frauncesLatinExtIt from '@fontsource-variable/fraunces/files/fraunces-latin-ext-wght-italic.woff2?url';
import serifLatin from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2?url';
import serifLatinExt from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-ext-wght-normal.woff2?url';
import serifGreek from '@fontsource-variable/source-serif-4/files/source-serif-4-greek-wght-normal.woff2?url';
import serifLatinIt from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-italic.woff2?url';
import serifLatinExtIt from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-ext-wght-italic.woff2?url';
import serifGreekIt from '@fontsource-variable/source-serif-4/files/source-serif-4-greek-wght-italic.woff2?url';

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF';
const GREEK = 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF';

const face = (family: string, url: string, style: 'normal' | 'italic', weight: string, range: string): string =>
  `@font-face{font-family:'${family}';font-style:${style};font-display:swap;font-weight:${weight};src:url(${url}) format('woff2-variations'),url(${url}) format('woff2');unicode-range:${range};}`;

const css = [
  face('Fraunces', frauncesLatin, 'normal', '100 900', LATIN),
  face('Fraunces', frauncesLatinExt, 'normal', '100 900', LATIN_EXT),
  face('Fraunces', frauncesLatinIt, 'italic', '100 900', LATIN),
  face('Fraunces', frauncesLatinExtIt, 'italic', '100 900', LATIN_EXT),
  face('Source Serif 4', serifLatin, 'normal', '200 900', LATIN),
  face('Source Serif 4', serifLatinExt, 'normal', '200 900', LATIN_EXT),
  face('Source Serif 4', serifGreek, 'normal', '200 900', GREEK),
  face('Source Serif 4', serifLatinIt, 'italic', '200 900', LATIN),
  face('Source Serif 4', serifLatinExtIt, 'italic', '200 900', LATIN_EXT),
  face('Source Serif 4', serifGreekIt, 'italic', '200 900', GREEK),
].join('\n');

if (typeof document !== 'undefined' && !document.getElementById('apes-fonts')) {
  const el = document.createElement('style');
  el.id = 'apes-fonts';
  el.textContent = css;
  document.head.appendChild(el);
}
