import type { MakaMujo } from "../../lib/Agent";
import distribution from "./distribution";

export default function api(streamer: MakaMujo) {
  return {
    '/api/speech': async () => Response.json({ speech: streamer.lastSpeech }),

    '/api/game': async () => Response.json(streamer.playing ?? {}),

    '/api/distribution': distribution(streamer),

    '/api/meta': {
      GET: () => Response.json(streamer.streamState),
      POST: async (req: Request) => {
        const body = await req.json();
        streamer.onAir(body.data);
        return Response.json({});
      },
    },
  };
}
