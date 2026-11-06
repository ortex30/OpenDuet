import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PageSection } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveInstructionsMutationOptions } from "@/lib/settings/mutations";
import {
  INSTRUCTIONS_LIMIT,
  instructionsQueryOptions,
} from "@/lib/settings/queries";
import { queryClient } from "@/query-client";

/**
 * One box, applied to every coworker in every channel.
 *
 * WHAT IT IS FOR, said on the screen rather than left to be guessed. A student has one coach, so
 * this is what the coach should know about them and how they like to be helped, which is what the
 * title, the description and the example in the empty box all say.
 */
export function StandingInstructions() {
  const stored = useQuery(instructionsQueryOptions());
  const save = useMutation(saveInstructionsMutationOptions(queryClient));

  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /*
   * The box holds the stored text until somebody types, and their typing after that.
   *
   * Null is "has not been edited", which is not the same as "is empty": seeding the state with ""
   * and then filling it in when the read lands would overwrite whatever they had already started
   * typing into a box that was ready before the network was.
   */
  useEffect(() => {
    if (stored.data !== undefined && draft === null) setDraft(stored.data);
  }, [stored.data, draft]);

  const text = draft ?? stored.data ?? "";
  const over = text.trim().length > INSTRUCTIONS_LIMIT;
  const unchanged = stored.data !== undefined && text === stored.data;

  const submit = () => {
    setProblem(null);
    setSaved(false);
    save.mutate(text, {
      onError: (thrown: Error) => setProblem(thrown.message),
      /* The server trims, so the box settles to what was actually stored rather than what was sent. */
      onSuccess: (asStored) => {
        setDraft(asStored);
        setSaved(true);
      },
    });
  };

  return (
    <PageSection
      description="Your coach keeps this in mind in every chat."
      title="About you"
    >
      {/* The box is drawn while the saved text loads, shut until it lands, so the page under it
          never jumps down when it does. */}
      {stored.error ? (
        <p className="mt-4 text-destructive text-sm" role="alert">
          {stored.error.message}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          <Textarea
            aria-label="About you"
            className="min-h-40"
            disabled={stored.isPending || save.isPending}
            onChange={(event) => {
              setDraft(event.target.value);
              setSaved(false);
            }}
            placeholder="I'm a junior. Walk me through math step by step, keep answers short, and quiz me before tests."
            value={text}
          />
          <div className="flex flex-row items-center justify-between gap-4">
            <p
              className={
                over
                  ? "text-destructive text-xs"
                  : "text-muted-foreground text-xs"
              }
            >
              {text.trim().length} of {INSTRUCTIONS_LIMIT} characters
            </p>
            <div className="flex flex-row items-center gap-3">
              {/*
               * One line, and only the news. A save that worked says so until the next keystroke; a
               * refusal shows the server's own sentence, which names what was wrong with it.
               */}
              {problem ? (
                <span className="text-destructive text-xs" role="alert">
                  {problem}
                </span>
              ) : saved ? (
                <span className="text-muted-foreground text-xs">Saved</span>
              ) : null}
              <Button
                disabled={
                  stored.isPending || save.isPending || over || unchanged
                }
                onClick={submit}
                size="sm"
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageSection>
  );
}
