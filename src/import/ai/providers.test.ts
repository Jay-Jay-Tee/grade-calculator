import { describe, expect, it } from "vitest";
import { detectProvider } from "./providers";

describe("provider detection from key format", () => {
  it.each([
    ["sk-ant-api03-abcdef", "anthropic"],
    ["sk-or-v1-abcdef", "openrouter"],
    ["gsk_abcdef123", "groq"],
    ["AIzaSyABCDEF", "gemini"],
    ["AQ.Ab8RNabc", "gemini"],
    ["sk-proj-abcdef", "openai"],
    ["sk-abcdefghijklmnopqrstuvwxyz012345", "openai"],
    ["some-random-key", null],
    ["", null],
  ])("%s -> %s", (key, expected) => {
    expect(detectProvider(key)).toBe(expected);
  });
});
