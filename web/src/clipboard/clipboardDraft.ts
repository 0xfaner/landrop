import { imageTypes, maxImageBytes, maxImages } from './limits'
import { linkedImageSelector, pendingImageSelector, readImageLink, readLinkedImage, type LinkedImage } from './linkedImage'

export type DraftPart = string | File | LinkedImage
export const draftImageSelector = `img, ${pendingImageSelector}`
const imageCaretAttribute = 'data-image-caret'

export function editorSelection(editor: HTMLElement) {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return
  const range = selection.getRangeAt(0)
  if (editor.contains(range.commonAncestorContainer)) return range
}

export function insertFragment(editor: HTMLElement, fragment: DocumentFragment, range?: Range | null) {
  editor.focus({ preventScroll: true })
  const at = range && editor.contains(range.commonAncestorContainer) ? range : document.createRange()
  if (at !== range) {
    at.selectNodeContents(editor)
    at.collapse(false)
  }
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(at)
  let needsCaret = true
  for (const node of [...fragment.childNodes]) {
    const image = node instanceof HTMLElement && node.matches(draftImageSelector)
    if (image && needsCaret) node.before(imageCaretLine())
    needsCaret = image
  }
  if (needsCaret && fragment.childNodes.length) fragment.append(imageCaretLine())
  const wrapper = document.createElement('div')
  wrapper.append(fragment)
  // The editing command keeps insertion in the browser's undo history.
  if (document.execCommand('insertHTML', false, wrapper.innerHTML)) return
  const last = wrapper.lastChild
  at.deleteContents()
  const fallback = document.createDocumentFragment()
  fallback.append(...wrapper.childNodes)
  at.insertNode(fallback)
  if (last instanceof HTMLElement && last.hasAttribute(imageCaretAttribute)) at.setStart(last, 0)
  else if (last) at.setStartAfter(last)
  at.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(at)
}

function imageCaretLine() {
  const line = document.createElement('div')
  line.setAttribute(imageCaretAttribute, '')
  line.append(document.createElement('br'))
  return line
}

export function readDraft(editor: HTMLElement, files: ReadonlyMap<string, File>): DraftPart[] {
  return readParts(editor, (node) => files.get(node.getAttribute('src') ?? ''), (node) => {
    if (node.matches(linkedImageSelector)) return readLinkedImage(node.dataset.clipboardImage ?? '', node.dataset.linkText)
  })
}

export function readPastedParts(data: DataTransfer) {
  const plain = data.getData('text/plain')
  const files = Array.from(data.files).filter((file) => imageTypes.includes(file.type))
  const html = data.getData('text/html')
  const fallback = [...(plain ? [files.length ? plain : readImageLink(plain) ?? plain] : []), ...files]
  if (!html) return fallback

  // Template contents are inert. Only text and files extracted below reach the editor.
  const template = document.createElement('template')
  template.innerHTML = html
  const content = template.content
  content.querySelectorAll('script, style, title, iframe, object, noscript, svg').forEach((node) => node.remove())
  const pairFiles = content.querySelectorAll('img').length === files.length
  let index = 0
  let budget = maxImageBytes
  let embeddedCount = 0
  const parts = readParts(content, (node) => {
    const attachment = pairFiles ? files[index++] : undefined
    const source = node.getAttribute('src') ?? ''
    const embedded = embeddedCount < maxImages ? embeddedImage(source, node.alt, budget) : undefined
    if (embedded) {
      embeddedCount++
      budget -= embedded.size
      return embedded
    }
    return attachment ?? readLinkedImage(source)
  })
  if (plain && parts.every((part) => typeof part === 'string')) return fallback
  if (!pairFiles) parts.push(...files)
  return parts
}

function embeddedImage(source: string, name: string, budget: number) {
  const header = /^data:(image\/(?:png|jpeg|webp|gif));base64,/i.exec(source)
  if (!header || source.length - header[0].length > Math.ceil(budget / 3) * 4) return
  try {
    const binary = atob(source.slice(header[0].length))
    if (!binary.length || binary.length > budget) return
    const type = header[1].toLowerCase()
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new File([bytes], name || `clipboard.${type.split('/')[1]}`, { type })
  } catch {
    return undefined
  }
}

function readParts(
  root: HTMLElement | DocumentFragment,
  readImage: (image: HTMLImageElement) => File | LinkedImage | undefined,
  readLink?: (node: HTMLElement) => LinkedImage | undefined,
): DraftPart[] {
  const parts: DraftPart[] = []
  let text = ''
  let needsLineBreak = false

  function read(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) {
        if (needsLineBreak) text += '\n'
        text += node.textContent.replace(/\u00a0/g, ' ')
        needsLineBreak = false
      }
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (readLink && node.hasAttribute(imageCaretAttribute) && !node.textContent && !node.querySelector(draftImageSelector)) return
    const image = node instanceof HTMLImageElement ? readImage(node) : readLink?.(node)
    if (image) {
      if (text) parts.push(text)
      parts.push(image)
      text = ''
      needsLineBreak = false
      return
    }
    if (node instanceof HTMLImageElement) return
    if (node.tagName === 'BR') {
      if (node.nextSibling) {
        text += needsLineBreak ? '\n\n' : '\n'
        needsLineBreak = false
      }
      return
    }
    const block = node.matches('div, p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr, section, article, figure')
    if (block && text && !text.endsWith('\n')) needsLineBreak = true
    if (block && node.childNodes.length === 1 && node.firstChild instanceof HTMLBRElement) {
      if (node === root.firstChild && node === root.lastChild) return
      text += '\n'
      needsLineBreak = !!node.previousSibling
      return
    }
    for (const child of node.childNodes) read(child)
    if (block && text && !text.endsWith('\n')) needsLineBreak = true
  }

  for (const child of root.childNodes) read(child)
  if (text) parts.push(text)
  return parts
}
