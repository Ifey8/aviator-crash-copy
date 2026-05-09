/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testRegex: "\\.test\\.ts$",
  moduleFileExtensions: ["ts", "js", "json"],
  transform: { "^.+\\.ts$": ["ts-jest", { isolatedModules: true }] },
  testTimeout: 10000,
};
