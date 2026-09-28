export type Theme = 'light' | 'dark'

/** Follows ChatGPT's own theme class on <html>, falling back to the OS setting. */
export function watchTheme(onChange: (t: Theme) => void): () => void {
  const html = document.documentElement
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  let last: Theme | null = null
  const read = () => {
    const cls = html.classList
    const theme: Theme = cls.contains('dark') ? 'dark' : cls.contains('light') ? 'light' : media.matches ? 'dark' : 'light'
    if (theme !== last) {
      last = theme
      onChange(theme)
    }
  }
  read()
  const observer = new MutationObserver(read)
  observer.observe(html, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
  media.addEventListener('change', read)
  return () => {
    observer.disconnect()
    media.removeEventListener('change', read)
  }
}
