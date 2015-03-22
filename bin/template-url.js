#!/usr/bin/env node

var path = require('path');
var root = path.resolve(__dirname, '..');
var exec = require('child_process').exec;

exec('git rev-parse HEAD', { cwd: root }, function (err, gitsha) {
    if (err) throw err;

    var url = [
      'https:/',
      'cf-templates-mapbox-us-east-1.s3.amazonaws.com',
      'streambot',
      gitsha.trim() + '.template'
    ].join('/');

    console.log(url);
});
