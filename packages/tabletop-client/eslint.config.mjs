import root from '../../eslint.config.mjs';

// The root rules apply unchanged. The files below are the original viewer code, ported with as
// few changes as possible (see README "Legacy code"): they contain unused variables, `var`-era
// patterns and `const scope = this` aliases that we deliberately do not rewrite. These three
// rules are relaxed for them only; new code (the .ts files, ui.js, skybox.js) is fully linted.
export default [
  ...root,
  {
    files: [
      'src/tabletop.js',
      'src/TranslateControls.js',
      'src/RotationControls.js',
      'src/ScaleControls.js',
      'src/MouseHover.js',
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
];
