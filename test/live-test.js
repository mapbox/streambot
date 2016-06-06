var test = require('tape');
var streambot = require('..');
var path = require('path');
var os = require('os');
var fs = require('fs');
var crypto = require('crypto');
var mkdirp = require('mkdirp');
var exec = require('child_process').exec;
var AWS = require('aws-sdk');
var s3 = new AWS.S3();
var kinesis = new AWS.Kinesis({ region: 'us-east-1' });

var testId = crypto.randomBytes(8).toString('hex');
console.log('Running test with id: %s', testId);

var tableName = 'streambot-test-' + testId;
var folder = path.join(os.tmpdir(), testId);
var bundle = path.join(os.tmpdir(), testId + '.zip');
var primaryStack = require('cfn-test')(test, 'streambot-' + testId, 'us-east-1');
var exampleStack = require('cfn-test')(test, testId, 'us-east-1');

// Build a streambot bundle that is customized for a particular env table name.
test('[live] bundle custom test code', function(assert) {
  mkdirp(folder + '/bin', function(err) {
    if (err) throw err;

    // Put a munged index.js into the tmpdir
    var mungedIndex = path.join(folder, 'index.js');
    var index = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8');
    index = index.replace('streambot-env', tableName);
    fs.writeFileSync(mungedIndex, index);

    // Put package.json into the tmpdir
    fs.createReadStream(path.resolve(__dirname, '..', 'package.json'))
      .pipe(fs.createWriteStream(path.join(folder, 'package.json')))
      .on('finish', function() {

        // Drag along bin/bundle so the tmpdir is npm-installable
        fs.createReadStream(path.resolve(__dirname, '..', 'bin', 'bundle'))
          .pipe(fs.createWriteStream(path.join(folder, 'bin', 'bundle')))
          .on('finish', function() {

            // do an npm install in the tmpdir
            exec('bin/bundle ' + folder + ' ' + bundle, function(err, stdout, stderr) {
              if (err) {
                console.error(stdout);
                console.error(stderr);
                throw err;
              }

              assert.end();
            });
          });
      });
  });
});

// Upload adjusted bundle to S3
test('[live] upload custom bundle', function(assert) {
  s3.putObject({
    Bucket: 'mapbox-us-east-1',
    Key: 'release/streambot/' + testId + '.zip',
    Body: fs.createReadStream(bundle),
    ACL: 'public-read'
  }, function(err) {
    if (err) throw err;
    assert.end();
  });
});

// Adjust a template to include the customized table name.
streambot.tableName = tableName;
var template = require('../cloudformation/streambot.template.js');
test('[live] confirm template adjustment', function(assert) {
  var templateTableName = template.Resources.StreambotEnvTable.Properties.TableName;
  assert.equal(templateTableName, tableName, 'Table name altered in test template');
  if (templateTableName !== tableName)
    throw new Error('Halting tests before stacks are created');
  assert.end();
});

// Deploy the adjusted streambot template
primaryStack.start(template, { GitSha: testId });

// Now that the stack has started, we can queue up the remaining tests
test('[live] queue up tests', function(assert) {
  moreTests();
  assert.end();
});

function moreTests() {
  // Now stacks are running, we need a helper to kill them if we fail somewhere
  function halt(err, assert) {
    exampleStack.delete();
    primaryStack.delete();
    fs.writeFileSync(examplePackage, JSON.stringify(originalPackage, null, 2));
    if (err) throw err;
    assert.end();
  }

  var examplePackage = path.resolve(__dirname, '..', 'streambot-example', 'package.json');
  var originalPackage = require(examplePackage);

  // Munge the example package.json to point at the altered streambot code
  test('[live] adjust example package.json', function(assert) {
    var mungedPackage = JSON.parse(JSON.stringify(originalPackage));
    mungedPackage.dependencies.streambot = folder;
    fs.writeFileSync(examplePackage, JSON.stringify(mungedPackage, null, 2));
    assert.end();
  });

  // Bundle and upload the streambot example template
  test('[live] upload streambot-example', function(assert) {
    var cmd = [
      path.resolve(__dirname, '..', 'bin', 'bundle'),
      path.resolve(__dirname, '..', 'streambot-example')
    ].join(' ');

    exec(cmd, function(err, stdout, stderr) {
      if (err) return halt(stderr, assert);

      s3.putObject({
        Bucket: 'mapbox',
        Key: 'apps/streambot/' + testId + '-example.zip',
        Body: fs.createReadStream(stdout.trim()),
        ACL: 'public-read'
      }, function(err) {
        if (err) throw err;
        assert.end();
      });
    });
  });

  // Deploy the example stack
  var exampleTemplate = require('../streambot-example/streambot-example.template.js');
  exampleTemplate.Resources.Role.Properties.Policies[0].PolicyDocument.Statement[1].Resource['Fn::Join'][1][2] = ':table/' + tableName;
  exampleStack.start(exampleTemplate, {
    GitSha: testId,
    EventBucket: 'mapbox',
    EventPrefix: 'example-records/' + testId,
    StreambotEnvFunctionArn: primaryStack.description.Outputs.filter(function(output) {
      return output.OutputKey === 'StreambotEnvFunctionArn';
    })[0].OutputValue
  });

  // The streambot example should write kinesis records to S3.
  test('[live] write to kinesis', function(assert) {
    console.log('Waiting 60 seconds to allow the example stack to stabilize...');

    setTimeout(function() {
      var streamName = exampleStack.description.Outputs.filter(function(output) {
        return output.OutputKey === 'StreamName';
      })[0].OutputValue;

      kinesis.putRecord({
        Data: 'test ' + testId,
        PartitionKey: 'a',
        StreamName: streamName
      }, function(err, response) {
        if (err) return halt(err, assert);

        console.log('Waiting 60 seconds to allow lambda to process the kinesis record...');

        setTimeout(function() {
          s3.getObject({
            Bucket: 'mapbox',
            Key: ['example-records', testId, response.SequenceNumber].join('/')
          }, function(err, data) {
            if (err && err.code === 'NoSuchKey') assert.fail('Record was not written to S3');
            if (err) return halt(err, assert);
            assert.ok(data.Body, 'Record was written to S3 by the example lambda function');
            assert.equal(data.Body.toString(), 'test ' + testId, 'Expected record was written to S3');
            halt(null, assert);
          });
        }, 60000);
      });
    }, 60000);
  });
}
