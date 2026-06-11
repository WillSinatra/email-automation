module.exports = {
  testEnvironment: "jsdom",
  testMatch: ["**/tests/**/*.test.jsx"],
  setupFilesAfterEnv: ["<rootDir>/tests/setupTests.js"],
  transform: {
    "^.+\\.[jt]sx?$": "babel-jest",
  },
  moduleFileExtensions: ["js", "jsx"],
};
