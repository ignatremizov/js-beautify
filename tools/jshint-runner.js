#!/usr/bin/env node

'use strict';

// JSHint uses a scoped, compatible minimatch version, including Windows paths.
require('jshint/src/cli.js').interpret(process.argv);
