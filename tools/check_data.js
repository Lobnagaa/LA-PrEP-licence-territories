/* Validate data/lapal_licence_coverage.json with the same rules the page uses.
 *
 * Usage (from the lapal-public-prototype folder, after tools/xlsx_to_json.py):
 *   node tools/check_data.js [path/to/file.json]
 * Exits 1 and lists every problem if the data would be rejected by the page.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const D = require('../src/data.js');

const file = process.argv[2] || path.join(__dirname, '..', 'data', 'lapal_licence_coverage.json');
const { errors, warnings } = D.validate(JSON.parse(fs.readFileSync(file, 'utf8')));
warnings.forEach(w => console.log('warning: ' + w));
if (errors.length) {
  console.error(errors.length + ' error(s); the page will refuse this data:');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log('OK: ' + path.basename(file) + ' passes (' + warnings.length + ' warning(s))');
