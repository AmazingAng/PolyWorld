import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    ".source/**",
    "next-env.d.ts",
    // Reference directory — not part of the project
    ".worldmonitor-ref/**",
  ]),
  {
    rules: {
      // Downgrade to warnings — these patterns (Date.now() in useMemo, setState in
      // hydration effects) are widespread and generally safe in this codebase.
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
      // Sync ref updates in render (ref.current = value) are a common pattern for
      // keeping event handler refs up-to-date. Downgrade to warning.
      "react-hooks/refs": "warn",
    },
  },
]);

export default eslintConfig;
