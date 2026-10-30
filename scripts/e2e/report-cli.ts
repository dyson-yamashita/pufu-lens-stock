import { parseArgs } from 'node:util';
import { reportDirectory, writeHtmlReport } from './report.ts';

const { values } = parseArgs({ options: { run: { type: 'string' } } });
const directory = await reportDirectory(values.run);
console.log(`E2E HTMLレポート: ${await writeHtmlReport(directory)}`);
