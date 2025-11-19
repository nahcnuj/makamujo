import { Box, Container, Layout } from "automated-gameplay-transmitter";
import { CharacterSprite } from "./components/CharacterSprite";
import "./index.css";

export function App() {
  return (
    <Layout count={10} span={8} className="bg-emerald-950/30 text-emerald-50 font-[Noto_Sans_CJK_JP] font-bold">
      <Container>
        <div className="text-xs opacity-25">
          {new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
        </div>
      </Container>
      <Container>
        <div className="h-full flex flex-col justify-between items-center">
          <div className="flex-none">
            <div className="text-5xl/15 text-emerald-300" style={{ rubyPosition: 'under' }}>
              <ruby>馬<rp>(</rp><rt>ま</rt><rp>)</rp></ruby>
              <ruby>可<rp>(</rp><rt>か</rt><rp>)</rp></ruby>
              <ruby>無<rp>(</rp><rt>む</rt><rp>)</rp></ruby>
              <ruby>序<rp>(</rp><rt>じょ</rt><rp>)</rp></ruby>
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
          <div className="flex-auto w-full">
            <Box>
              Side
            </Box>
          </div>
        </div>
      </Container>
      <Container>
        <div className="flex gap-2 h-full">
          <div className="flex-none w-45 max-h-full aspect-square">
            <CharacterSprite />
          </div>
          <div className="flex-auto h-full">
            <Box>
              Bottom
            </Box>
          </div>
        </div>
      </Container>
    </Layout>
  );
}

export default App;
