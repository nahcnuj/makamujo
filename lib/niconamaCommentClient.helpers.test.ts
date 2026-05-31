import { describe, expect, it } from 'bun:test';
import { countNumberedAgentComments, filterAgentCommentsWithText, formatAgentCommentEntry, getCommentTextFromAgentComment } from './niconamaCommentClient.helpers';

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

  it('counts only numbered comments', () => {
    const comments = [
      { data: { comment: 'hello', no: 1 } },
      { data: { comment: 'ad message', type: 'ad' } },
      { data: { comment: 'world', num: 2 } },
      { data: { comment: 'no number' } },
    ];

    expect(countNumberedAgentComments(comments as any)).toBe(2);
  });

  it('formats recent comment entries with numbers when available', () => {
    expect(formatAgentCommentEntry({ data: { comment: 'hello', no: 123 } })).toBe('#123 hello');
    expect(formatAgentCommentEntry({ data: { comment: 'world' } })).toBe('world');
    expect(formatAgentCommentEntry({ data: { comment: '(コメントあり)' } })).toBeNull();
  });

  it('does not duplicate comment numbers when text already begins with the same prefix', () => {
    expect(formatAgentCommentEntry({ data: { comment: '#123 hello', no: 123 } })).toBe('#123 hello');
    expect(formatAgentCommentEntry({ data: { comment: '#99 こんにちは', no: 99 } })).toBe('#99 こんにちは');
  });
});
