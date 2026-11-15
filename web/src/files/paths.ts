export function parentPath(path: string) {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')))
}

export function joinPath(folder: string, name: string) {
  return folder ? folder + '/' + name : name
}

export function containsPath(folder: string, path: string) {
  return path === folder || path.startsWith(folder + '/')
}
