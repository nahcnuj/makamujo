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

export default function distribution(streamer: { talkModel: { toJSON(): string } }) {
  return {
    OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
    GET: async (_req?: Request, _server?: any) => {
      try {
        const json = JSON.parse(streamer.talkModel.toJSON());
        return jsonWithCors(json.model ?? {});
      } catch (err) {
        console.warn('[WARN]', 'failed to get distribution', err);
        return jsonWithCors({}, 500);
      }
    },
  };
}
