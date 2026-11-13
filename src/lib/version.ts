/**
 * The one place the product's name and version are written down.
 *
 * Before v9 these were string literals in eight components, and the v8.3 release
 * left half of them saying v8.2 — the header, the sidebar, the About dialog and
 * the Settings blurb all disagreed with each other in the shipped build. A rename
 * from MathForge to Mathorium would have had to find every one of them again.
 *
 * `package.json` still carries its own copy because npm requires it there; the
 * build asserts the two agree rather than trying to import JSON at runtime.
 */
export const APP_NAME = "Mathorium";

/** Marketing version — what the UI shows. */
export const APP_VERSION = "9.0";

/** Full semver, for the About dialog and export headers. */
export const APP_BUILD = "10.0.0";

/** "Mathorium 9.0" — the form used in prompts and document generators. */
export const APP_LABEL = `${APP_NAME} ${APP_VERSION}`;

export const APP_TAGLINE = "Free AI Math OCR & LaTeX / MathML Studio";

export const APP_AUTHOR = "Samir Uddin Ahmed";

export const APP_URL = "https://mathorium.vercel.app";
