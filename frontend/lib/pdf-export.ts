import { splitSceneSegments } from './scene-format';

function sanitizeFilenamePart(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_');
}

const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const MARGIN_MM = 10;
const CONTENT_WIDTH_MM = PAGE_WIDTH_MM - MARGIN_MM * 2;
const CONTENT_HEIGHT_MM = PAGE_HEIGHT_MM - MARGIN_MM * 2;
const GAP_MM = 4;

function buildMirrorContent(mirror: HTMLDivElement, value: string) {
  for (const segment of splitSceneSegments(value)) {
    if (segment.isDirection) {
      const em = document.createElement('em');
      em.textContent = segment.text;
      mirror.appendChild(em);
    } else {
      mirror.appendChild(document.createTextNode(segment.text));
    }
  }
}

/**
 * html2canvas doesn't reflow/wrap <textarea> content correctly — it renders
 * the value as if white-space were non-wrapping, cutting long lines off at
 * the element's edge. Swap each textarea for a plain div mirror (same
 * classes, explicit pre-wrap, with "[Cena: ...]"/"[Texto na tela: ...]"
 * italicized the same way the on-screen overlay does) just for the capture,
 * then restore it.
 */
function swapTextareasForMirrors(root: HTMLElement) {
  const textareas = Array.from(root.querySelectorAll('textarea'));
  const restore: Array<() => void> = [];

  for (const textarea of textareas) {
    // Read layout while the textarea is still visible — offsetHeight/lineHeight
    // become unreliable once display:none is applied below.
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 0;
    const textareaHeight = textarea.offsetHeight;

    const mirror = document.createElement('div');
    mirror.className = textarea.className;
    buildMirrorContent(mirror, textarea.value);
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = 'break-word';
    // html2canvas's own text-wrap pass can compute one more wrapped line than
    // the real browser layout did (confirmed by comparing captured canvas
    // height to the live bounding box — they match, but the extra line of
    // glyphs still gets clipped). Give it a line-height of slack, and don't
    // let the inherited `.field-lpx` overflow:hidden hard-clip if it still does.
    mirror.style.minHeight = `${textareaHeight + lineHeight}px`;
    mirror.style.overflow = 'visible';

    const originalDisplay = textarea.style.display;
    textarea.style.display = 'none';
    textarea.after(mirror);

    restore.push(() => {
      mirror.remove();
      textarea.style.display = originalDisplay;
    });
  }

  return () => restore.forEach(fn => fn());
}

/**
 * Renders each `.pdf-avoid-break` section inside `element` as its own canvas and
 * stacks them into an A4 PDF, starting a new page whenever a section wouldn't
 * fully fit — so cards/sections never get cut in half across a page break.
 */
export async function downloadBriefingPdf(
  element: HTMLElement,
  marca: string,
  produto: string,
) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const restoreTextareas = swapTextareasForMirrors(element);

  try {
    const sections = Array.from(element.querySelectorAll<HTMLElement>('.pdf-avoid-break'));
    const units = sections.length > 0 ? sections : [element];

    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    let cursorY = MARGIN_MM;
    let isFirstUnit = true;

    for (const unit of units) {
      const canvas = await html2canvas(unit, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgHeightMm = (canvas.height / canvas.width) * CONTENT_WIDTH_MM;

      const fitsOnCurrentPage = cursorY + imgHeightMm <= PAGE_HEIGHT_MM - MARGIN_MM;
      if (!isFirstUnit && !fitsOnCurrentPage) {
        doc.addPage();
        cursorY = MARGIN_MM;
      } else if (!isFirstUnit && imgHeightMm > CONTENT_HEIGHT_MM && cursorY > MARGIN_MM) {
        // Oversized section that will never fit in one page — still give it a
        // fresh page so it clips as little as possible instead of splitting low on this one.
        doc.addPage();
        cursorY = MARGIN_MM;
      }

      doc.addImage(canvas.toDataURL('image/jpeg', 0.98), 'JPEG', MARGIN_MM, cursorY, CONTENT_WIDTH_MM, imgHeightMm);
      cursorY += imgHeightMm + GAP_MM;
      isFirstUnit = false;
    }

    const filename = `Briefing_${sanitizeFilenamePart(marca)}_${sanitizeFilenamePart(produto)}.pdf`;
    doc.save(filename);
  } finally {
    restoreTextareas();
  }
}
