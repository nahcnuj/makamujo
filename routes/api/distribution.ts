export default function distribution(streamer: { talkModel: { toJSON(): string } }) {
  return {
    GET: async (_req?: Request, _server?: any) => {
      try {
        const json = JSON.parse(streamer.talkModel.toJSON());
        return Response.json(json.model ?? {});
      } catch (err) {
        console.warn('[WARN]', 'failed to get distribution', err);
        return Response.json({}, { status: 500 });
      }
    },
  };
}
