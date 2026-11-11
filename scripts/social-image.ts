import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Compute once at build time; replacing the logo also changes its social preview URL.
const logo = readFileSync(new URL('../public/pufu-lens-logo.png', import.meta.url));
const version = createHash('sha256').update(logo).digest('hex').slice(0, 16);
export const socialImagePath = `/pufu-lens-logo.png?v=${version}`;
