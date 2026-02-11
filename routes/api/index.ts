import type { MakaMujo } from "../../lib/Agent";
import distribution from "./distribution";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const jsonWithCors = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'Content-Type': 'application/json;charset=utf-8',
    ...corsHeaders,
  },
});

export default function api(streamer: MakaMujo) {
  return {
    '/api/speech': {
      GET: async () => jsonWithCors({ speech: streamer.lastSpeech }),
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
    },

    '/api/game': {
      GET: async () => jsonWithCors(streamer.playing ?? {}),
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
    },

    '/api/distribution': distribution(streamer),

    '/api/meta': {
      GET: () => jsonWithCors(streamer.streamState),
      POST: async (req: Request) => {
        const body = await req.json();
        streamer.onAir(body.data);
        return jsonWithCors({});
      },
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
    },
  };
}
