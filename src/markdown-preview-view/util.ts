import { TextEditor } from 'atom'
import * as path from 'path'
import * as fs from 'fs'
import { handlePromise, atomConfig, packagePath } from '../util'

export function editorForId(editorId: number): TextEditor | undefined {
  for (const editor of atom.workspace.getTextEditors()) {
    if (editor.id === editorId) {
      return editor
    }
  }
  return undefined
}

function* getStyles(context?: string | null): IterableIterator<string> {
  const elements = atom.styles.getStyleElements()

  for (const element of elements) {
    if (context === undefined || element.getAttribute('context') === context) {
      yield element.innerText
    }
  }
}

function getClientStyle(file: string): string {
  return atom.themes.loadStylesheet(
    path.join(packagePath(), 'styles-client', `${file}.less`),
  )
}

export function getUserStyles() {
  const el =
    atom.styles.styleElementsBySourcePath[atom.styles.getUserStyleSheetPath()]
  if (!el) return []
  return [el.innerText]
}

function getSyntaxTheme(themeName: string): Iterable<string> {
  if (themeName !== '') {
    const themes = atom.themes.getLoadedThemes()
    if (themes) {
      const [theme] = themes.filter((x) => x.name === themeName)
      if (theme) {
        const stshts = theme
          .getStylesheetPaths()
          .map((p) => atom.themes.loadStylesheet(p))
        return processEditorStyles(stshts)
      }
    }
    atom.notifications.addWarning('Failed to load syntax theme', {
      detail: `Markdown-preview-plus couldn't find '${themeName}'`,
    })
  }
  // default
  return processEditorStyles(getStyles('atom-text-editor'))
}

function* getActivePackageStyles(
  packageName: string,
): IterableIterator<string> {
  const pack = atom.packages.getActivePackage(packageName)
  if (!pack) return
  const stylesheets = pack.getStylesheetPaths()
  for (const ss of stylesheets) {
    const element = atom.styles.styleElementsBySourcePath[ss]
    if (element) yield element.innerText
  }
}

export function getPreviewStyles(display: boolean): string[] {
  if (window['markdown-preview-plus-tests']?.getStylesOverride) {
    return window['markdown-preview-plus-tests']?.getStylesOverride(display)
  }
  const styles = []
  if (display) {
    // global editor styles
    const globalStyles =
      atom.styles.styleElementsBySourcePath['global-text-editor-styles']
    if (globalStyles) {
      styles.push(...processWorkspaceStyles([globalStyles.innerText]))
    }
    styles.push(getClientStyle('editor-global-font'))
    // package styles
    const packList = atomConfig().importPackageStyles
    if (packList.includes('*')) {
      styles.push(...processEditorStyles(getStyles()))
      styles.push(getClientStyle('patch'))
    } else {
      for (const pack of packList) {
        styles.push(...processEditorStyles(getActivePackageStyles(pack)))
      }
      // explicit compatibility with the fonts package
      if (packList.includes('fonts')) {
        const fontsVar =
          atom.styles.styleElementsBySourcePath['fonts-package-editorfont']
        if (fontsVar) styles.push(...processEditorStyles([fontsVar.innerText]))
      }
    }
  }

  styles.push(getClientStyle('generic'))
  if (display) styles.push(getClientStyle('display'))
  if (atomConfig().useGitHubStyle) {
    styles.push(getClientStyle('github'))
  } else {
    styles.push(getClientStyle('default'))
  }
  styles.push(...getSyntaxTheme(atomConfig().syntaxThemeName))
  styles.push(...processEditorStyles(getUserStyles()))
  return styles
}

function* processEditorStyles(styles: Iterable<string>) {
  for (const style of styles) {
    yield style.replace(/\batom-text-editor\b/g, 'pre.editor-colors')
  }
}

function* processWorkspaceStyles(styles: Iterable<string>) {
  for (const style of styles) {
    yield style.replace(/\batom-workspace\b/g, ':root')
  }
}

function getMarkdownPreviewCSS() {
  const cssUrlRefExp = /url\(atom:\/\/markdown-preview-plus\/assets\/(.*)\)/

  return getPreviewStyles(false)
    .join('\n')
    .replace(cssUrlRefExp, function (
      _match,
      assetsName: string,
      _offset,
      _string,
    ) {
      // base64 encode assets
      const assetPath = path.join(packagePath(), 'assets', assetsName)
      const originalData = fs.readFileSync(assetPath, 'binary')
      const base64Data = new Buffer(originalData, 'binary').toString('base64')
      return `url('data:image/jpeg;base64,${base64Data}')`
    })
}

export function buildLineMap(html: string) {
  const domparser = new DOMParser()
  const dom = domparser.parseFromString(html, 'text/html')

  const map: { [line: number]: { tag: string; index: number }[] } = {}
  for (const elem of Array.from(dom.querySelectorAll(`[data-source-lines]`))) {
    const he = elem as HTMLElement
    const [start, end] = he.dataset
      .sourceLines!.split(' ')
      .map((x) => parseInt(x, 10))
    let e: Element | null = elem
    const path = []
    while (e && e.tagName !== 'BODY') {
      let index = 0
      let sib: Element = e
      while (sib.previousElementSibling) {
        sib = sib.previousElementSibling
        if (sib.tagName === e.tagName) index++
      }
      path.unshift({ tag: e.tagName.toLowerCase(), index })
      e = e.parentElement
    }
    for (let i = start; i < end; ++i) {
      if (!map[i] || map[i].length < path.length) map[i] = path
    }
  }
  return map
}

function mathJaxScript(texConfig: MathJax.TeXInputProcessor) {
  return `\
<script type="text/x-mathjax-config">
  MathJax.Hub.Config({
    jax: ["input/TeX","output/HTML-CSS"],
    extensions: ["[a11y]/accessibility-menu.js"],
    'HTML-CSS': {
      availableFonts: [],
      webFont: 'TeX',
      undefinedFamily: ${JSON.stringify(
        atomConfig().mathConfig.undefinedFamily,
      )},
      mtextFontInherit: true,
    },
    TeX: ${JSON.stringify(texConfig, undefined, 2)},
    showMathMenu: true
  });
</script>
<script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.4/MathJax.js"></script>`
}

export function mkHtml(
  title: string,
  html: HTMLDocument,
  renderLaTeX: boolean,
  texConfig: MathJax.TeXInputProcessor,
) {
  let maybeMathJaxScript: string
  if (renderLaTeX) {
    maybeMathJaxScript = mathJaxScript(texConfig)
  } else {
    maybeMathJaxScript = ''
  }
  return `\
<!DOCTYPE html>
<html data-markdown-preview-plus-context="html-export">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
    <link rel="stylesheet" href="../assets/css/main.css" />
    <title>${title}</title>${maybeMathJaxScript}
    <style>${getMarkdownPreviewCSS()}</style>
${html.head!.innerHTML}
  </head>
  <body>
  <!-- Wrapper -->
<div id="wrapper">

<!-- Main -->
<div id="main">
  <div class="inner">

<header id="header">
<h3><a href="../index.html">Harsha Kokel</a></h3>
<ul class="icons">
<li id="linkedin">
  <a target="_blank" href="http://linkedin.com/in/harshakokel" title="linkedin" class="icon fa-linkedin">
    <span class="label" >Linked in</span>
  </a>
</li>
<li id="github">
  <a target="_blank" href="https://github.com/harshakokel" title="github" class="icon fa-github">
    <span class="label" >Github</span>
  </a>
</li>
<li id="email">
  <a  href="mailto:hkokel@utdallas.edu" title="mail" class="icon fa-envelope" >
    <span class="label" >Mail</span>
  </a>
</li>
<li id="twitter">
  <a target="_blank" href="https://twitter.com/harsha_kokel" title="twitter" class="icon fa-twitter" >
    <span class="label" title="Twitter">Twitter</span>
  </a>
</li>
</ul>
</header>

<div class="page__section">
<nav class="breadcrumb breadcrumb_type5" aria-label="Breadcrumb">
  <ol class="breadcrumb__list r-list">
    <li class="breadcrumb__group">
      <a href="../" class="breadcrumb__point r-link">Home</a>
      <span class="breadcrumb__divider" aria-hidden="true">&raquo;</span>
    </li>
    <li class="breadcrumb__group">
      <a href="./" class="breadcrumb__point r-link">Blog</a>
      <span class="breadcrumb__divider" aria-hidden="true">&raquo;</span>
    </li>
    <li class="breadcrumb__group">
      <span class="breadcrumb__point" aria-current="page">Post</span>
    </li>
  </ol>
</nav>
</div>

    ${html.body.innerHTML}

    </div>
    </div>

    <!-- Sidebar -->
    <div id="sidebar" class="inactive">
      <div class="inner">

        <!-- Menu -->
        <nav id="menu">
          <header class="major">
            <h2>Menu</h2>
          </header>
          <ul>
            <li><a href="../">Homepage</a></li>
            <li><a href="../cv.html">CV</a></li>
            <li><a href="./">Blog Posts</a></li>
          </ul>
        </nav>

        <!-- Footer -->
        <footer id="footer">
          <p class="copyright"> Design: <a href="https://html5up.net">HTML5 UP</a>.</p>
        </footer>

      </div>
    </div>

    </div>

	<!-- Scripts -->

	<script src="../assets/js/jquery.min.js"></script>
	<script src="../assets/js/skel.min.js"></script>
	<script src="../assets/js/util.js"></script>
	<!--[if lte IE 8]><script src="../assets/js/ie/respond.min.js"></script><![endif]-->
	<script src="../assets/js/main.js"></script>

  </body>
</html>
` // Ensure trailing newline
}

export function destroy(item: { destroy(): void }) {
  const pane = atom.workspace.paneForItem(item)
  if (pane) handlePromise(pane.destroyItem(item))
  else item.destroy()
}
