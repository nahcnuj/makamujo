import { Box, Container } from "automated-gameplay-transmitter";
import { useAgentContext } from "../contexts/AgentContext";
import { CharacterSprite } from "./CharacterSprite";

export function StreamerPanel() {
  const { speech, silent } = useAgentContext();

  return (
    <div className="flex gap-2 h-full">
      <div className="flex-none w-45 max-h-full -m-1 aspect-square">
        <CharacterSprite />
      </div>
      <div className="flex-auto h-full">
        <Box>
          <Container>
            <div className="w-full h-full text-3xl/9 break-all text-ellipsis overflow-hidden">
              {silent ? '・・・' : speech.replace(/。$/, '')}
            </div>
          </Container>
        </Box>
      </div>
    </div>
  );
}
