/**
 * Identifier generation (0003 P4).
 *
 * Identifiers must not be sequential or guessable: the data is importable and a
 * user may merge backups from two devices, where sequential ids generated in the
 * same millisecond would collide and silently lose an entry.
 */
export function newId(): string {
  const webCrypto = globalThis.crypto
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID()
  }
  // randomUUID needs a secure context. GitHub Pages is HTTPS, but a user opening
  // the build over plain http on a LAN would otherwise get a thrown error.
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16))
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x40 // version 4
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80 // variant
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  throw new Error('No cryptographic random source available')
}
