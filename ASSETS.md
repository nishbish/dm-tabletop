# Assets

Third-party assets (3D models, textures, maps, fonts, icons) must have a licence that allows
redistribution. Record each asset's source and licence here when it is added. If a licence is
unclear, do not add the asset; ask the maintainer first.

| Asset                                                                                                                                                                                                                                                                    | Source                                                                                    | Licence                                                          | Added by |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| three (npm, bundled into the tabletop-client build; includes the examples/jsm controls, post-processing and loaders used)                                                                                                                                                | https://github.com/mrdoob/three.js                                                        | MIT                                                              | step 4   |
| material-icons (npm): the `material-icons.woff2` icon font, bundled into the tabletop-client build                                                                                                                                                                       | https://github.com/marella/material-icons (Google Material Icons)                         | Apache-2.0                                                       | step 4   |
| vite (npm, dev dependency, build tool only)                                                                                                                                                                                                                              | https://github.com/vitejs/vite                                                            | MIT                                                              | step 4   |
| @playwright/test (npm, dev dependency, end-to-end test only; downloads Chromium separately)                                                                                                                                                                              | https://github.com/microsoft/playwright                                                   | Apache-2.0                                                       | step 4   |
| Creature list `packages/initiative-tracker/src/data/srd-creatures.json`: name, AC, hit points, hit dice, DEX and CR of the monsters and NPCs printed in the D&D 5e System Reference Document 5.1, extracted by `packages/initiative-tracker/scripts/build-creatures.mjs` | https://dnd.wizards.com/resources/systems-reference-document (official "SRD_CC_v5.1.pdf") | CC-BY-4.0, https://creativecommons.org/licenses/by/4.0/legalcode | step 5   |
| happy-dom (npm, dev dependency, DOM tests only)                                                                                                                                                                                                                          | https://github.com/capricorn86/happy-dom                                                  | MIT                                                              | step 5   |

### SRD 5.1 attribution (CC-BY-4.0)

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

The same notice is in `packages/initiative-tracker/NOTICE.md` and README, and in the footer of the tracker demo page. A host app that shows the built-in creature list should show it too. The generator script can read the PDF with `pdfjs-dist` (Apache-2.0, https://github.com/mozilla/pdf.js); it is only used by hand to regenerate the data and is not a dependency of any package.

No images, textures, skyboxes, 3D models or fonts other than the icon font are included. The tabletop-client sky is a
gradient drawn in code, walls are generated geometry, tokens without a picture are drawn cylinders, and the
text font is the system font stack.

## Not included (pending licence clearance)

These were part of the original viewer and are deliberately **not** in this repository. A hosting app may supply its own
(see `assetBaseUrl` and `skybox` in the tabletop-client README).

- Skyboxes: the `miramar` (day, `.tga`) and `night` (`.png`) six-face skybox images.
- Wall models: the `wall*` model files.
- The `Pacifico-Regular.ttf` font.
- All images, textures and demo map pictures from the original uploads and library.
- The original loading animation stylesheet (`loader.css`; replaced by a simple spinner) and the
  Material Components Web stylesheet (not used by the viewer, dropped).

Not yet verified: the origin of the original `context-menu.css` / `context-menu.js` (the menu). They are the maintainer's
own ported files according to the task, but their provenance is not recorded anywhere; please confirm.

Dropped dependencies of the original client: camera-controls, uuid, lodash, slim-select, material-components-web
and Font Awesome were listed in its package file but not used by the viewer code, so they were not added.
