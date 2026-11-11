#!/usr/bin/env node
/**
 * Container entry point.
 *
 * The image has no root package.json, so this file is CommonJS there and this
 * shim is all it needs to take. The implementation lives in `server/main.cjs`,
 * which is CommonJS in *this* repo too (the root package.json is ESM for the
 * frontend), so `npm start` and tests exercise exactly the same code path.
 */

require('./server/main.cjs');
