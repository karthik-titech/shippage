import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  js.configs.recommended,

  // ----------------------------------------------------------------
  // Server-side TypeScript (Node, no DOM)
  // ----------------------------------------------------------------
  {
    files: ["src/server/**/*.ts", "src/shared/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.server.json",
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    },
  },

  // ----------------------------------------------------------------
  // Client-side TypeScript/React (browser + DOM)
  // ----------------------------------------------------------------
  {
    files: ["src/client/**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.client.json",
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // React
      "react/react-in-jsx-scope": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react/no-danger": "error",
      // TypeScript
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    },
    settings: {
      react: { version: "detect" },
    },
  },

  // ----------------------------------------------------------------
  // Client page files — setTimeout(async () => {}) is idiomatic and safe
  // ----------------------------------------------------------------
  {
    files: ["src/client/pages/**/*.{ts,tsx}", "src/client/components/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
    },
  },

  // ----------------------------------------------------------------
  // Express route files — async route handlers are valid in Express
  // despite what no-misused-promises thinks
  // ----------------------------------------------------------------
  {
    files: ["src/server/routes/**/*.ts"],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
    },
  },

  // ----------------------------------------------------------------
  // Test files — more relaxed
  // ----------------------------------------------------------------
  {
    files: ["tests/**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "no-console": "off",
    },
  },

  // ----------------------------------------------------------------
  // Config/bin files at root
  // ----------------------------------------------------------------
  {
    files: ["*.config.{js,ts}", "bin/*.js"],
    languageOptions: {
      globals: globals.node,
    },
  },

  {
    ignores: ["dist/**", "node_modules/**", "*.d.ts"],
  }
);
