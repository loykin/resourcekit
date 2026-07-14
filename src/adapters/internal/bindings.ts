import { useEffect, useState } from 'react'
import type { RenderContext } from '../../react/types'

export function useBindingValue(
  ctx: RenderContext,
  name: string,
  literal?: unknown,
): unknown {
  const hasBinding = ctx.bindings.has(name)
  const [value, setValue] = useState<unknown>()

  useEffect(() => {
    if (!hasBinding) {
      setValue(undefined)
      return
    }
    let active = true
    ctx.bindings
      .read(name)
      .then((next) => {
        if (active) setValue(next)
      })
      .catch(() => {
        if (active) setValue(undefined)
      })
    return () => {
      active = false
    }
  }, [ctx.bindings, ctx.bindings.revision, hasBinding, name])

  return hasBinding ? value : literal
}
