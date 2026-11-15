import { useId, useRef, useState, type ComponentProps } from 'react'
import { Textarea } from '@primer/react'
import { ClipboardResizeHandle } from './ClipboardResizeHandle'

type Props = Omit<ComponentProps<typeof Textarea>, 'block' | 'resize'>

export function ClipboardTextarea({ id, style, ...props }: Props) {
  const generatedID = useId()
  const fieldID = id ?? generatedID
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [height, setHeight] = useState<number>()

  return <>
    <Textarea {...props} id={fieldID} ref={textarea} block resize="vertical" style={{ ...style, height: height ?? style?.height }} />
    <ClipboardResizeHandle target={textarea} controls={fieldID} onResize={setHeight} />
  </>
}
