/*
 * Ported from the Santulan pilot kit's santulan_gen/generate.py: the `Measurer` class and `run()` function - the part
 * that needs a real browser (pagination needs real rendered heights; a PDF needs a real page to print). Playwright's
 * Python sync_api has no Node equivalent, so this is async throughout where the source was sync - the HTML the two
 * produce is identical either way (verified against the Python original in engine.js/pages.js).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { buildModel } = require('./engine');
const P = require('./pages');
const C = require('./content');

/** `measure(htmlBlocks) => Promise<number[]>`, one rendered height per block - generate.py's Measurer.__call__. */
function makeMeasurer(page) {
  return async (blocks) => {
    let doc = `<!doctype html><html><head><meta charset="utf-8">${P.FONTS}<style>${P.CSS}</style></head><body><div style="width:666px">${blocks.map((b) => `<div class="m" style="margin:0">${b}</div>`).join('')}</div></body></html>`;
    doc = doc.replace('class="m" style="margin:0"><div class="blk"', 'class="m"><div class="blk" style="margin-top:0"');
    await page.setContent(doc);
    await page.waitForTimeout(600);
    return page.evaluate("Array.from(document.querySelectorAll('.m')).map(e=>Math.ceil(e.getBoundingClientRect().height))");
  };
}

/**
 * Renders one student's report. `s` is the same shape generate.py's run() reads from student.json (report_id,
 * display_name, age, class?, assessment_date, consent_ok, status?, release?, domains, goals?, plan?, previous?,
 * first_name?, reviewer_status? for --final).
 * @param {object} s
 * @param {{ outdir: string, final?: boolean, pdf?: boolean, browserInstance?: import('playwright').Browser }} opts
 * @returns {{ base: string, html: string, manifest: object, pdfPath: string|null }}
 */
async function renderReport(s, { outdir, final = false, pdf = true, browserInstance = null } = {}) {
  if (!s.consent_ok) throw new Error(`REN-19: consent_ok is not true for ${s.report_id}; report not generated`);
  const m = buildModel(s, { final });
  if (final && (s.reviewer_status || 'PENDING') !== 'APPROVED') throw new Error(`REN-18: --final refused, reviewer_status is not APPROVED for ${s.report_id}`);
  if (final && !C.CONTENT_APPROVED) throw new Error('REN-15/OD-13: --final refused because content is still AUTHORED-SAMPLE (content.CONTENT_APPROVED is False)');

  fs.mkdirSync(outdir, { recursive: true });
  const ownBrowser = !browserInstance;
  const browser = browserInstance || await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
    try {
      const [pages, kinds] = await P.build(m, makeMeasurer(page));
      const doc = P.document(m, pages);
      const base = path.join(outdir, s.report_id);
      fs.writeFileSync(`${base}.html`, doc);
      const manifest = { report_id: s.report_id, status: m.status, band: m.band, pages: kinds, domains: m.manifest(), release: m.rel, draft: m.draft };
      fs.writeFileSync(`${base}.manifest.json`, JSON.stringify(manifest, null, 1));

      let pdfPath = null;
      if (pdf) {
        await page.setContent(doc);
        await page.waitForTimeout(1200);
        pdfPath = `${base}.pdf`;
        await page.pdf({ path: pdfPath, width: '794px', height: '1123px', printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });
      }
      return { base, html: doc, manifest, pdfPath };
    } finally {
      await page.close();
    }
  } finally {
    if (ownBrowser) await browser.close();
  }
}

module.exports = { renderReport, makeMeasurer };
