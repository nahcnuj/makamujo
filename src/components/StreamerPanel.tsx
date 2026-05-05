/** @jsxImportSource hono/jsx/dom */
import { Box, Container } from "../agt-compat";
import { useAgentContext } from "../contexts/AgentContext";
import { CharacterSprite } from "./CharacterSprite";

export function StreamerPanel() {
  const { speech, silent } = useAgentContext();
  const speechText = typeof speech === 'string' ? speech : '';

  return (
    <div className="flex gap-2 h-full">
      <div className="flex-none w-45 max-h-full -m-1 aspect-square">
        <CharacterSprite />
      </div>
      <div className="flex-auto h-full">
        <Box borderColor="border-emerald-300" borderWidth="border-8" borderStyle="border-double" rounded="rounded-xl">
          <Container>
            <div className="w-full h-full text-3xl/9 break-all text-ellipsis overflow-hidden">
              {silent ? '・・・' : speechText.replace(/。$/, '')}
            </div>
          </Container>
        </Box>
      </div>
    </div>
  );
}
