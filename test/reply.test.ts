import { describe, expect, it } from 'vitest';
import { classifyReply, decideReplyAction, previewText } from '../src/logic/reply.ts';

describe('classifyReply', () => {
  it.each([
    ['STOP', 'opt_out'],
    ['stop', 'opt_out'],
    ['Stop texting me please', 'opt_out'],
    ['please UNSUBSCRIBE me', 'opt_out'],
    ['opt out', 'opt_out'],
    ['Opt-out', 'opt_out'],
    ['OPTOUT', 'opt_out'],
    ['stop all', 'opt_out'],
    ['CANCEL', 'opt_out'],
    ['end', 'opt_out'],
    ['Quit.', 'opt_out'],
    ['remove me', 'opt_out'],
    ['YES STOP', 'opt_out'],
    ['YES', 'book'],
    ['yes please', 'book'],
    ['Y', 'book'],
    ['Ja', 'book'],
    ['Book', 'book'],
    ['BOOK for 4 at 7?', 'book'],
    ['Can I make a booking?', 'book'],
    ['Do you have gluten free bases?', 'other'],
    ['Can I cancel my order?', 'other'],
    ['No olives, remove mushrooms', 'other'],
    ['I saw it on Facebook', 'other'],
    ['', 'other'],
    ['🍕', 'other'],
  ])('"%s" is %s', (body, intent) => {
    expect(classifyReply(body)).toBe(intent);
  });

  it('trusts Twilio when its own opt out handling flagged the message', () => {
    expect(classifyReply('anything at all', 'STOP')).toBe('opt_out');
    expect(classifyReply('YES', 'START')).toBe('book');
  });
});

describe('decideReplyAction', () => {
  it('ignores a retried webhook', () => {
    expect(decideReplyAction({ is_new: false, opted_out_before: false }, 'book')).toBe('duplicate');
  });

  it('opts out, sends the link, or alerts the manager', () => {
    expect(decideReplyAction({ is_new: true, opted_out_before: false }, 'opt_out')).toBe('opted_out');
    expect(decideReplyAction({ is_new: true, opted_out_before: false }, 'book')).toBe('link_sent');
    expect(decideReplyAction({ is_new: true, opted_out_before: false }, 'other')).toBe('manager_alerted');
  });

  it('never texts an opted out number that asks for the link', () => {
    expect(decideReplyAction({ is_new: true, opted_out_before: true }, 'book')).toBe('blocked_opted_out');
  });
});

describe('previewText', () => {
  it('collapses whitespace and truncates long messages', () => {
    expect(previewText('  hello \n there ')).toBe('hello there');
    expect(previewText('x'.repeat(400))).toHaveLength(300);
    expect(previewText(undefined)).toBe('');
  });
});
