import { describe, expect, it } from 'vitest';
import { taskRefOf } from '@/features/entity/taskPanel';

describe('taskRefOf', () => {
  it('reads the task from a Projects link', () => {
    expect(taskRefOf('/projects/p/?p=FST&t=FST-0001')).toBe('FST-0001');
    expect(taskRefOf('/projects/?t=abc123')).toBe('abc123');
    expect(taskRefOf('/projects/p?t=SB-1')).toBe('SB-1');
  });
  it('ignores every other link', () => {
    expect(taskRefOf('/projects/p/?p=FST')).toBe('');
    expect(taskRefOf('/requests/?r=1')).toBe('');
    expect(taskRefOf('https://example.com/projects/?t=X')).toBe('');
  });
});
