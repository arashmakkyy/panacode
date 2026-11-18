import { useState } from "react";
import { SegmentedControl, type SegmentedOption } from "../ui/segmented-control";
import { CodeSuggestion } from "./code-suggestion";
import { SAMPLE_CODE } from "./sample";

type DemoState = "live" | "empty" | "error";

const STATES: ReadonlyArray<SegmentedOption<DemoState>> = [
  { value: "live", label: "Suggestion" },
  { value: "empty", label: "No changes" },
  { value: "error", label: "Error" },
];

/** The preview from the docs: the simulated suggestion plus its two quiet states. */
export function CodeSuggestionDemo() {
  const [state, setState] = useState<DemoState>("live");
  const [run, setRun] = useState(0);

  const backToLive = () => {
    setState("live");
    setRun((current) => current + 1);
  };

  return (
    <div className="box-border flex min-h-[776px] w-full flex-col items-center justify-start gap-4">
      <SegmentedControl
        options={STATES}
        value={state}
        onValueChange={setState}
        label="Suggestion state"
        className="max-w-full flex-none"
      />

      {state === "live" ? (
        <CodeSuggestion key={run} />
      ) : state === "empty" ? (
        <CodeSuggestion
          code={SAMPLE_CODE}
          hunks={[]}
          filePath="src/billing"
          instruction="Use the shared fetch client"
          onRegenerate={backToLive}
        />
      ) : (
        <CodeSuggestion
          code={SAMPLE_CODE}
          hunks={[]}
          status="error"
          filePath="src/billing"
          error="The model stopped responding. Nothing was changed."
          onRegenerate={backToLive}
        />
      )}
    </div>
  );
}
