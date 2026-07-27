import { describe, expect, it } from 'vitest'
import { isMutationRef, scanMutationRefs } from './mutationRef'

describe('isMutationRef', () => {
  it('accepts a bare $mutation ref', () => {
    expect(isMutationRef({ $mutation: 'deleteUser' })).toBe(true)
  })

  it('rejects a non-string $mutation', () => {
    expect(isMutationRef({ $mutation: 1 })).toBe(false)
  })

  it('rejects extra keys', () => {
    expect(isMutationRef({ $mutation: 'deleteUser', extra: true })).toBe(false)
  })

  it('rejects non-records', () => {
    expect(isMutationRef('deleteUser')).toBe(false)
    expect(isMutationRef(null)).toBe(false)
    expect(isMutationRef(['deleteUser'])).toBe(false)
  })
})

describe('scanMutationRefs', () => {
  it('finds refs nested in objects and arrays', () => {
    const refs = scanMutationRefs({
      submit: { mutation: { $mutation: 'deleteUser' } },
      list: [{ mutation: { $mutation: 'archiveUser' } }],
      plain: 'not a ref',
    })
    expect(refs).toEqual([{ $mutation: 'deleteUser' }, { $mutation: 'archiveUser' }])
  })

  it('returns an empty array when nothing matches', () => {
    expect(scanMutationRefs({ a: 1, b: [2, 3] })).toEqual([])
  })
})
