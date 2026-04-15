import type { ComponentPropsWithoutRef } from 'react'

type AppImageProps = ComponentPropsWithoutRef<'img'>

export function AppImage({
  decoding = 'async',
  loading = 'lazy',
  ...props
}: AppImageProps) {
  return <img decoding={decoding} loading={loading} {...props} />
}
