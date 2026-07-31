import { useEffect, useRef, useState } from "hono/jsx/dom";
import { Box, Container } from "../agt-compat";
import { useAgentContext } from "../contexts/AgentContext";
import { CharacterSprite } from "./CharacterSprite";
import { SpeechLine } from "./SpeechLine";

const RISE_MS = 300;

export function StreamerPanel() {
  const { speechLines, silent } = useAgentContext();
  const [displayLines, setDisplayLines] = useState<string[]>(speechLines);
  const [risePx, setRisePx] = useState(0);
  const firstRef = useRef<HTMLDivElement | null>(null);
  const displayRef = useRef(displayLines);
  displayRef.current = displayLines;

  useEffect(() => {
    const prev = displayRef.current ?? [];
    const next = speechLines;

    const isShift =
      prev.length === 2 &&
      next.length === 2 &&
      prev[1] === next[0] &&
      prev[0] !== next[0];

    if (!isShift) {
      setDisplayLines(next);
      setRisePx(0);
      return;
    }

    // Rise first with three utterances, then drop the top one.
    setDisplayLines([prev[0]!, prev[1]!, next[1]!]);
    setRisePx(0);

    requestAnimationFrame(() => {
      const h = firstRef.current?.offsetHeight ?? 0;
      setRisePx(h);
      window.setTimeout(() => {
        setDisplayLines(next);
        setRisePx(0);
      }, RISE_MS);
    });
  }, [speechLines]);

  return (
    <div className="flex gap-2 h-full">
      <div className="flex-none w-45 max-h-full -m-1 aspect-square">
        <CharacterSprite />
      </div>
      <div className="flex-auto h-full">
        <Box borderColor="border-emerald-300" borderWidth="border-8" borderStyle="border-double" rounded="rounded-xl">
          <Container>
            <div className="w-full h-full text-3xl/9 break-all overflow-hidden">
              {silent ? (
                "（コメントしてね）"
              ) : (
                <div
                  style={
                    risePx > 0
                      ? {
                          transform: `translateY(-${risePx}px)`,
                          transition: `transform ${RISE_MS}ms ease-out`,
                        }
                      : {}
                  }
                >
                  {displayLines.map((line, i) => (
                    <div
                      key={`${i}-${line}`}
                      ref={
                        i === 0
                          ? (el: HTMLDivElement | null) => {
                              firstRef.current = el;
                            }
                          : undefined
                      }
                    >
                      <SpeechLine
                        text={line}
                        animate={i === displayLines.length - 1}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Container>
        </Box>
      </div>
    </div>
  );
}
