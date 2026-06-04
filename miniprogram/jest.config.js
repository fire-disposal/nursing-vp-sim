module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  setupFiles: ["<rootDir>/__tests__/setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
  },
}
