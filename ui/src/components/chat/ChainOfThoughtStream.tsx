import { ThinkingBar } from "./ThinkingBar";
import type { ThinkingBarState } from "../../types";

interface ChainOfThoughtStreamProps {
  state: ThinkingBarState;
  privacyMasked?: boolean;
}

export function ChainOfThoughtStream({ state, privacyMasked = true }: ChainOfThoughtStreamProps) {
  return <ThinkingBar state={state} privacyMasked={privacyMasked} />;
}
