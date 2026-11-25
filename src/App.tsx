import { Box, Container } from "./agt-compat";
import { BroadcastHeartbeat } from "./components/BroadcastHeartbeat";
import { GamePanel } from "./components/GamePanel";
import { AvatarPanel, SpeechPanel } from "./components/StreamerPanel";
import { AgentProvider } from "./contexts/AgentContext";
import { isVrtMode } from "./vrtMode";

/**
 * Broadcast layout (2x2 grid):
 * - Top-left: game screen (black box keyed transparent to OBS display capture)
 * - Top-right: "馬可無序" title + game info window
 * - Bottom-left: avatar
 * - Bottom-right: speech window
 *
 * VRT mode freezes non-deterministic elements so captured frames are reproducible.
 */
export function App() {
  return (
    <AgentProvider>
      {isVrtMode() && (
        <style>{`*{animation:none!important;transition:none!important;opacity:1!important;filter:none!important;backdrop-filter:none!important;mix-blend-mode:normal!important;box-shadow:none!important;text-shadow:none!important;will-change:auto!important;}`}</style>
      )}
      <div className="w-screen h-screen grid grid-cols-2 grid-rows-2 bg-emerald-950/30 text-emerald-50 font-[Noto_Sans_CJK_JP] font-bold">
        <Container>
          <Box
            bgColor="bg-black"
            borderColor="border-emerald-300"
            borderWidth="border-8"
            borderStyle="border-double"
            rounded="rounded-xl"
          />
        </Container>
        <Container>
          <div className="h-full flex flex-col justify-between items-center">
            <div className="flex-none">
              <div
                className="text-5xl/15 text-emerald-300"
                style={{ rubyPosition: "under" }}
              >
                <ruby>
                  馬<rp>(</rp>
                  <rt>ま</rt>
                  <rp>)</rp>
                </ruby>
                <ruby>
                  可<rp>(</rp>
                  <rt>か</rt>
                  <rp>)</rp>
                </ruby>
                <ruby>
                  無<rp>(</rp>
                  <rt>む</rt>
                  <rp>)</rp>
                </ruby>
                <ruby>
                  序<rp>(</rp>
                  <rt>じょ</rt>
                  <rp>)</rp>
                </ruby>
              </div>
            </div>
            <div className="flex-none">
              <div className="my-1 text-center text-3xl/12 text-white">
                <span className="px-3 bg-black rounded-sm">
                  <span className="pr-3 font-normal text-white">&#x1D54F;</span>
                  &#xFF20;
                  <span className="font-mono">makamujo</span>
                </span>
              </div>
            </div>
            <div className="flex-auto w-full max-h-full">
              <Box
                borderColor="border-emerald-300"
                borderWidth="border-8"
                borderStyle="border-double"
                rounded="rounded-xl"
              >
                <Container>
                  <GamePanel />
                </Container>
              </Box>
            </div>
          </div>
        </Container>
        <Container>
          <AvatarPanel />
        </Container>
        <Container>
          <SpeechPanel />
        </Container>
      </div>
      {!isVrtMode() && <BroadcastHeartbeat />}
    </AgentProvider>
  );
}

export default App;
