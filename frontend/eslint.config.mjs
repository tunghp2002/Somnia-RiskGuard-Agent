import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default [
  // --- Ignored paths ---
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "dist/**",
      "coverage/**",
      "public/**",
      "*.min.js",
    ],
  },

  // --- Next.js recommended (React, Hooks, jsx-a11y, TypeScript) ---
  ...nextCoreWebVitals,
  ...nextTypescript,

  // --- Main rules ---
  {
    rules: {
      // Code quality
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-unused-vars": "off", // Handled by @typescript-eslint
      "no-duplicate-imports": "error",
      "no-var": "error",
      "prefer-const": "error",

      // Spacing & whitespace
      "no-multiple-empty-lines": ["error", { max: 1, maxEOF: 0, maxBOF: 0 }],
      "no-trailing-spaces": "error",
      "eol-last": ["error", "always"],
      "object-curly-spacing": ["error", "always"],
      "array-bracket-spacing": ["error", "never"],
      "arrow-spacing": ["error", { before: true, after: true }],
      "keyword-spacing": ["error", { before: true, after: true }],
      "space-before-blocks": "error",
      "space-before-function-paren": ["error", {
        anonymous: "never",
        named: "never",
        asyncArrow: "always",
      }],
      "lines-between-class-members": ["error", "always", {
        exceptAfterSingleLine: true,
      }],
      "lines-around-comment": ["warn", {
        beforeBlockComment: true,
        afterBlockComment: false,
        beforeLineComment: true,
        afterLineComment: false,
        allowBlockStart: true,
        allowClassStart: true,
        allowObjectStart: true,
        allowArrayStart: true,
      }],

      // TypeScript
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": ["warn", {
        prefer: "type-imports",
        fixStyle: "inline-type-imports",
      }],

      // React
      "react/self-closing-comp": "warn",
      "react/jsx-curly-brace-presence": ["warn", {
        props: "never",
        children: "never",
      }],

      // Next.js
      "@next/next/no-html-link-for-pages": "error",

      // Import order
      "import/order": ["warn", {
        groups: [
          "builtin",
          "external",
          "internal",
          ["parent", "sibling"],
          "index",
          "type",
        ],
        "newlines-between": "always",
        alphabetize: { order: "asc", caseInsensitive: true },
      }],
    },
  },

  // --- Relaxed rules for config files ---
  {
    files: ["*.config.{js,mjs,ts}", "*.config.*.{js,mjs,ts}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
