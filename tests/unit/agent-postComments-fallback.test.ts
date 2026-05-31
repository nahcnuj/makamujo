import { describe, it, expect, jest, beforeEach } from 'bun:test';

// Recreate the minimal fallback `agent.postComments` logic from index.ts
// and assert it forwards comments to the provided `streamer.listen`.

describe('fallback agent.postComments', () => {
  let listenSpy: any;
  let streamer: any;
  let agent: any;

  beforeEach(() => {
    listenSpy = jest.fn();
    streamer = {
      listen: listenSpy,
    };

    agent = {
      postComments: (comments: unknown) => {
        try {
          if (Array.isArray(comments)) {
            streamer.listen(comments as any);
          } else if (comments) {
            streamer.listen([comments] as any);
          }
        } catch (e) {
          // swallow
        }
      },
    };
  });

  it('forwards an array of comments to streamer.listen', () => {
    const comments = [{ data: { comment: 'hi' } }, { data: { comment: 'bye' } }];
    agent.postComments(comments);
    expect(listenSpy).toHaveBeenCalledTimes(1);
    expect(listenSpy).toHaveBeenCalledWith(comments);
  });

  it('forwards a single comment object as an array to streamer.listen', () => {
    const comment = { data: { comment: 'hello' } };
    agent.postComments(comment);
    expect(listenSpy).toHaveBeenCalledTimes(1);
    expect(listenSpy).toHaveBeenCalledWith([comment]);
  });

  it('does nothing when null/undefined is passed', () => {
    agent.postComments(null);
    agent.postComments(undefined);
    expect(listenSpy).not.toHaveBeenCalled();
  });
});
