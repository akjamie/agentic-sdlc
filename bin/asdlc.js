#!/usr/bin/env node
import { run } from '../src/cli.js';

run().then((code) => {
  process.exitCode = code;
});
