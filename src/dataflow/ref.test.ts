import { describe, expect, it } from 'vitest'
import { isDataflowRef, scanDataflowRefs } from './ref'

describe('isDataflowRef', () => {
  it('accepts a bare $dataflow ref', () => {
    expect(isDataflowRef({ $dataflow: 'incidents' })).toBe(true)
  })

  it('accepts a $dataflow ref with a path', () => {
    expect(isDataflowRef({ $dataflow: 'incidents', path: 'rows.0' })).toBe(true)
  })

  it('rejects a non-string $dataflow', () => {
    expect(isDataflowRef({ $dataflow: 1 })).toBe(false)
  })

  it('rejects extra keys', () => {
    expect(isDataflowRef({ $dataflow: 'incidents', extra: true })).toBe(false)
  })

  it('rejects non-records', () => {
    expect(isDataflowRef('incidents')).toBe(false)
    expect(isDataflowRef(null)).toBe(false)
    expect(isDataflowRef(['incidents'])).toBe(false)
  })
})

describe('scanDataflowRefs', () => {
  it('finds refs nested in objects and arrays', () => {
    const refs = scanDataflowRefs({
      data: { $dataflow: 'incidents' },
      list: [{ $dataflow: 'incidentDetail', path: 'summary' }],
      plain: 'not a ref',
    })
    expect(refs).toEqual([{ $dataflow: 'incidents' }, { $dataflow: 'incidentDetail', path: 'summary' }])
  })

  it('returns an empty array when nothing matches', () => {
    expect(scanDataflowRefs({ a: 1, b: [2, 3] })).toEqual([])
  })
})
