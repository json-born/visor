import { expect, test } from 'claude-code/testing'

import { latestPerBranch } from './ci-runs'

test('keeps only the newest run for each branch', () => {
  expect(
    latestPerBranch([
      { branch: 'a', updatedAt: 1 },
      { branch: 'b', updatedAt: 5 },
      { branch: 'a', updatedAt: 3 },
      { branch: 'c', updatedAt: 4 },
      { branch: 'b', updatedAt: 2 },
    ])
  ).toEqual([
    { branch: 'b', updatedAt: 5 },
    { branch: 'c', updatedAt: 4 },
    { branch: 'a', updatedAt: 3 },
  ])
})
