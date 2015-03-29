var test = require('tape');
var path = require('path');
var fs = require('fs');
var exec = require('child_process').exec;
var zipfile = require('zipfile');

var example = path.resolve(__dirname, '..', 'streambot-example');
var bundle = path.resolve(__dirname, '..', 'bin', 'bundle');

// prep by installing npm modules
test('[bundle] npm install', function(assert) {
  exec('npm install', { cwd: example }, function(err, stdout, stderr) {
    if (err) {
      console.log(stdout);
      console.log(stderr);
      throw err;
    }

    assert.end();
  });
});

test('[bundle] bundle', function(assert) {
  exec([bundle, example].join(' '), function(err, stdout, stderr) {
    assert.ifError(err, 'bundled');

    if (err) {
      console.log(stdout);
      console.log(stderr);
    }

    var outFile = stdout.trim();
    assert.ok(fs.existsSync(outFile), 'creates zipfile');
    var zf = new zipfile.ZipFile(outFile);
    var filenames = zf.names;

    assert.ok(filenames.indexOf('index.js'), 'contains index.js');
    assert.ok(filenames.indexOf('package.json'), 'contains package.json');
    assert.ok(filenames.indexOf('streambot-example.template.json'), 'contains streambot-example.template.json');
    assert.ok(filenames.indexOf('node_modules/streambot/index.js'), 'contains node_modules/streambot/index.js');
    assert.ok(filenames.indexOf('node_modules/mapnik/lib/binding/node-v11-linux-x64/mapnik.node'), 'contains node_modules/mapnik/lib/binding/node-v11-linux-x64/mapnik.node');
    assert.ok(filenames.indexOf('node_modules/tape/index.js') < 0, 'does not contain node_modules/tape/index.js');

    assert.end();
  });
});

test('[bundle] back to normal', function(assert) {
  var binding = path.join(
    example,
    'node_modules',
    'mapnik',
    'lib',
    'binding'
  );

  var dir = fs.readdirSync(binding)[0];
  var re = new RegExp(process.platform + '-' + process.arch);
  assert.ok(re.test(dir), 'folder for platform/arch');
  assert.ok(fs.readdirSync(path.join(binding, dir)).indexOf('mapnik.node'), 'found mapnik.node');

  var expected = path.join(
    example,
    'node_modules',
    'tape',
    'index.js'
  );

  assert.ok(fs.existsSync(expected), 'devDependencies reinstalled');

  assert.end();
});
