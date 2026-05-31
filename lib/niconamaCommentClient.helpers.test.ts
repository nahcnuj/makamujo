import { describe, expect, it } from 'bun:test';
import { filterAgentCommentsWithText, getCommentTextFromAgentComment } from './niconamaCommentClient';

describe('Niconama comment helpers', () => {
  it('extracts trimmed text from AgentComment-like objects', () => {
    const item = { data: { comment: '  hello world  ', no: 1, userId: 'user123' } };
    expect(getCommentTextFromAgentComment(item)).toBe('hello world');
  });

  it('returns null for non-string or empty fields', () => {
    expect(getCommentTextFromAgentComment({ data: { comment: '' } })).toBeNull();
    expect(getCommentTextFromAgentComment({ data: { text: null } })).toBeNull();
    expect(getCommentTextFromAgentComment(null)).toBeNull();
  });

  it('filters comments without usable text', () => {
    const comments = [
      { data: { comment: 'first comment' } },
      { data: { comment: '(コメントあり)' } },
      { data: { text: 'second comment' } },
      { data: { comment: '' } },
    ];

    const filtered = filterAgentCommentsWithText(comments as any);
    expect(filtered.length).toBe(2);
    expect(filtered.map((item) => getCommentTextFromAgentComment(item))).toEqual([
      'first comment',
      'second comment',
    ]);
  });
});
