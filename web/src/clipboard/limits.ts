export const maxImageBytes = 256 * 1024 * 1024
export const maxImages = 64
export const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const maxTextBytes = 256 * 1024
const encoder = new TextEncoder()

export function exceedsTextLimit(text: string) {
  return text.length > maxTextBytes || encoder.encode(text).length > maxTextBytes
}
